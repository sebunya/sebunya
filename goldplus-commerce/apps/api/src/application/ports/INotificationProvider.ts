export type NotificationResult = {
  success: boolean;
  code?: string;
  message?: string;
};

export interface INotificationProvider {
  send(recipient: string, message: string): Promise<NotificationResult>;
}
