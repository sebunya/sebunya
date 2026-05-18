export interface PesaPalBillingAddress {
  email_address: string;
  phone_number: string;
  first_name: string;
  last_name: string;
}

export interface PesaPalSubmitOrderInput {
  id: string;
  currency: string;
  amount: number;
  description: string;
  callback_url: string;
  cancellation_url: string;
  notification_id: string;
  billing_address: PesaPalBillingAddress;
}

export interface PesaPalSubmitOrderResponse {
  order_tracking_id: string;
  merchant_reference: string;
  redirect_url: string;
}

export interface PesaPalTransactionStatusResponse {
  order_tracking_id: string;
  merchant_reference: string;
  amount: number;
  currency: string;
  status_code: number;
  payment_status_description: string;
  payment_method?: string;
  confirmation_code?: string;
  payment_account?: string;
}

export interface IPesaPalClient {
  submitOrderRequest(input: PesaPalSubmitOrderInput): Promise<PesaPalSubmitOrderResponse>;
  getTransactionStatus(orderTrackingId: string): Promise<PesaPalTransactionStatusResponse>;
}
