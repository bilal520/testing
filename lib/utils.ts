import { CacRating } from './accounts'

export const CAC_STYLES: Record<CacRating, { bg: string; text: string; stripe: string; label: string }> = {
  excellent: { bg: 'bg-green-100',  text: 'text-green-800',  stripe: 'bg-green-500',  label: 'Excellent' },
  good:      { bg: 'bg-amber-100',  text: 'text-amber-800',  stripe: 'bg-amber-500',  label: 'Good'      },
  average:   { bg: 'bg-orange-100', text: 'text-orange-800', stripe: 'bg-orange-500', label: 'Average'   },
  bad:       { bg: 'bg-red-100',    text: 'text-red-800',    stripe: 'bg-red-500',    label: 'Bad'       },
}

export function fmt(value: number, currency: string): string {
  if (currency === 'PKR') return `Rs ${Math.round(value).toLocaleString()}`
  if (currency === 'AED') return `AED ${value.toFixed(2)}`
  if (currency === 'USD') return `$${value.toFixed(2)}`
  return `${value.toFixed(2)} ${currency}`
}

export function fmtRoas(value: number): string {
  return `${value.toFixed(2)}×`
}

export function safeDiv(a: number, b: number): number {
  return b === 0 ? 0 : a / b
}
