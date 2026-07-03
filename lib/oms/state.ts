// OMS order state machine — pure, no I/O, unit-testable.
// The whole point of the OMS: only a confirmed, complete, non-duplicate,
// acceptable-risk order can be booked to a courier. This file enforces that.

export type OmsState =
  | 'new'
  | 'pending_confirmation'
  | 'confirmed'
  | 'no_answer'
  | 'incomplete_address'
  | 'review_hold'
  | 'cancelled'
  | 'ready_to_dispatch'
  | 'dispatched'
  | 'observed'          // full-mirror: exists in Shopify but outside the workflow (fulfilled/cancelled/pre-OMS)
  | 'rto_hold'          // repeat returner — agent decides (prepaid / confirm / cancel)
  | 'awaiting_payment'  // Online Payments tab — prepaid required before dispatch
  | 'booked'           // warehouse: courier consignment created (CN assigned)
  | 'cn_printed'       // warehouse: label/CN printed
  | 'packed'           // warehouse: physically packed (scanned)
  | 'picked_up'        // warehouse: handed to / collected by courier

export const OMS_STATES: OmsState[] = [
  'new', 'pending_confirmation', 'confirmed', 'no_answer',
  'incomplete_address', 'review_hold', 'cancelled', 'ready_to_dispatch', 'dispatched', 'observed',
  'rto_hold', 'awaiting_payment', 'booked', 'cn_printed', 'packed', 'picked_up',
]

// Allowed transitions. Anything not listed is rejected by canTransition().
export const TRANSITIONS: Record<OmsState, OmsState[]> = {
  new:                  ['pending_confirmation', 'incomplete_address', 'review_hold', 'cancelled', 'rto_hold', 'awaiting_payment'],
  pending_confirmation: ['confirmed', 'cancelled', 'no_answer', 'incomplete_address', 'review_hold', 'rto_hold', 'awaiting_payment'],
  no_answer:            ['pending_confirmation', 'confirmed', 'cancelled', 'incomplete_address', 'awaiting_payment', 'rto_hold'],
  incomplete_address:   ['pending_confirmation', 'confirmed', 'cancelled', 'awaiting_payment'],
  review_hold:          ['ready_to_dispatch', 'cancelled', 'pending_confirmation', 'awaiting_payment', 'rto_hold'],
  confirmed:            ['ready_to_dispatch', 'review_hold', 'incomplete_address', 'cancelled', 'awaiting_payment'],
  rto_hold:             ['pending_confirmation', 'confirmed', 'awaiting_payment', 'incomplete_address', 'review_hold', 'cancelled'],
  awaiting_payment:     ['confirmed', 'pending_confirmation', 'ready_to_dispatch', 'cancelled'],
  ready_to_dispatch:    ['booked', 'dispatched', 'cancelled', 'review_hold'],
  booked:               ['cn_printed', 'ready_to_dispatch', 'cancelled'],
  cn_printed:           ['packed', 'booked', 'cancelled'],
  packed:               ['picked_up', 'cn_printed', 'cancelled'],
  picked_up:            ['dispatched', 'cancelled'],
  dispatched:           [],   // courier_orders takes over
  cancelled:            [],   // terminal
  observed:             [],   // terminal — mirror-only, not agent-actionable
}

// Warehouse fulfillment stages (the Warehouse desk), in order.
export const WAREHOUSE_STAGES: OmsState[] = ['ready_to_dispatch', 'booked', 'cn_printed', 'packed', 'picked_up']

// States an agent may MANUALLY move an order into (the "Move to…" control).
// Cancel is excluded (it has its own reason-required action); terminals excluded.
export const MOVE_TARGETS: OmsState[] = [
  'pending_confirmation', 'no_answer', 'incomplete_address', 'review_hold',
  'rto_hold', 'awaiting_payment', 'confirmed', 'ready_to_dispatch',
]

// 'observed' is treated as out-of-workflow (like a terminal) — never queued.
export const TERMINAL_STATES: OmsState[] = ['dispatched', 'cancelled', 'observed']

export function isOmsState(s: string): s is OmsState {
  return (OMS_STATES as string[]).includes(s)
}

export function canTransition(from: OmsState, to: OmsState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

/** Hard guard: courier booking is ONLY allowed from ready_to_dispatch. */
export function canBook(state: OmsState): boolean {
  return state === 'ready_to_dispatch'
}

// Shopify tag mirrored for each state (additive — never replaces existing tags).
export const STATE_TAG: Record<OmsState, string> = {
  new:                  'oms-new',
  pending_confirmation: 'oms-pending',
  confirmed:            'oms-confirmed',
  no_answer:            'oms-no-answer',
  incomplete_address:   'oms-incomplete-address',
  review_hold:          'oms-review-hold',
  cancelled:            'oms-cancelled',
  ready_to_dispatch:    'oms-ready',
  dispatched:           'oms-dispatched',
  observed:             'oms-observed',   // never actually synced (mirror is read-only)
  rto_hold:             'oms-rto',
  awaiting_payment:     'oms-awaiting-payment',
  booked:               'oms-booked',
  cn_printed:           'oms-cn-printed',
  packed:               'oms-packed',
  picked_up:            'oms-picked',
}

// Which agent-workspace queue an order belongs to (null = not in a work queue).
export type OmsQueue = 'rto' | 'payments' | 'pending' | 'no_answer' | 'incomplete_address' | 'duplicates' | 'high_risk' | 'ready'

export function queueFor(state: OmsState, isDuplicate: boolean, _riskLevel: string): OmsQueue | null {
  if (state === 'rto_hold')           return 'rto'
  if (state === 'awaiting_payment')   return 'payments'
  if (state === 'incomplete_address') return 'incomplete_address'
  if (state === 'no_answer')          return 'no_answer'
  if (state === 'review_hold')        return isDuplicate ? 'duplicates' : 'high_risk'
  if (state === 'pending_confirmation') return 'pending'
  if (state === 'confirmed' || state === 'ready_to_dispatch') return 'ready'
  return null
}
