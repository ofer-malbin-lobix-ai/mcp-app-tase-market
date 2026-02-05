export interface SubscriptionMetadata {
  plan: 'monthly' | 'yearly';
  paypal_subscription_id: string;
  subscription_status: 'active' | 'cancelled' | 'suspended' | 'expired';
  expires_at: string;
  [key: string]: unknown;
}

export interface PlanConfig {
  id: string;
  name: string;
  price: number;
  currency: string;
  interval: 'MONTH' | 'YEAR';
  planId: string;
}

export interface PayPalSubscription {
  id: string;
  status: string;
  status_update_time: string;
  plan_id: string;
  start_time: string;
  quantity: string;
  shipping_amount: {
    currency_code: string;
    value: string;
  };
  subscriber: {
    email_address: string;
    payer_id: string;
    name: {
      given_name: string;
      surname: string;
    };
  };
  billing_info: {
    outstanding_balance: {
      currency_code: string;
      value: string;
    };
    cycle_executions: Array<{
      tenure_type: string;
      sequence: number;
      cycles_completed: number;
      cycles_remaining: number;
      current_pricing_scheme_version: number;
      total_cycles: number;
    }>;
    next_billing_time: string;
    failed_payments_count: number;
  };
  custom_id?: string;
  links: Array<{
    href: string;
    rel: string;
    method: string;
  }>;
}

export interface PayPalWebhookEvent {
  id: string;
  event_version: string;
  create_time: string;
  resource_type: string;
  resource_version: string;
  event_type: string;
  summary: string;
  resource: {
    id: string;
    status: string;
    status_update_time: string;
    plan_id: string;
    custom_id?: string;
    billing_info?: {
      next_billing_time: string;
      cycle_executions: Array<{
        tenure_type: string;
        sequence: number;
        cycles_completed: number;
      }>;
    };
  };
  links: Array<{
    href: string;
    rel: string;
    method: string;
  }>;
}

export interface PayPalTokenResponse {
  scope: string;
  access_token: string;
  token_type: string;
  app_id: string;
  expires_in: number;
  nonce: string;
}

export interface CreateSubscriptionRequest {
  planType: 'monthly' | 'yearly';
}

export interface CreateSubscriptionResponse {
  approvalUrl: string;
  subscriptionId: string;
}
