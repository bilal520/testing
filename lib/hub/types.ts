export type MessageSource = 'facebook' | 'instagram' | 'whatsapp' | 'gmail'
export type MessageSourceType = 'comment' | 'dm' | 'message' | 'email'
export type MessageCategory =
  | 'complaint'
  | 'feedback'
  | 'review'
  | 'cancel_reason'
  | 'creative_idea'
  | 'question'
  | 'other'
export type Sentiment = 'positive' | 'negative' | 'neutral'
export type Urgency = 'high' | 'medium' | 'low'

export interface Message {
  id: string
  source: MessageSource
  source_type: MessageSourceType
  external_id?: string
  sender_name?: string
  sender_id?: string
  content: string
  post_id?: string
  post_url?: string
  received_at: string
  created_at: string
  category?: MessageCategory
  sub_category?: string
  sentiment?: Sentiment
  urgency?: Urgency
  categorized_at?: string
  raw_data?: Record<string, unknown>
}

export interface DailyReport {
  id: string
  report_date: string
  generated_at: string
  total_messages: number
  top_complaint?: string
  top_feedback?: string
  consensus_summary?: string
  video_ideas: VideoIdea[]
  product_flags: string[]
  category_breakdown: Record<MessageCategory, number>
  sentiment_breakdown: Record<Sentiment, number>
  full_report?: string
}

export interface VideoIdea {
  title: string
  hook: string
  angle: 'organic' | 'ads' | 'both'
  source_quote: string
  why: string
}

export interface CreativeIdea {
  id: string
  source_message_id?: string
  idea_type: 'video_organic' | 'video_ads' | 'product' | 'website'
  idea: string
  customer_quote?: string
  extracted_at: string
  used: boolean
}
