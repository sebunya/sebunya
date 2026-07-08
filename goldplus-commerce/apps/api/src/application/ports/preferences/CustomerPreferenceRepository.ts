export interface CustomerPreferenceModel {
  userId: string;
  channels: {
    email: boolean;
    sms: boolean;
    whatsapp: boolean;
  };
  topics: Record<string, boolean>;
  interests: Record<string, boolean>;
  intent: Record<string, any>;
  updatedAt: Date;
}

export interface CustomerPreferenceRepository {
  getPreferences(userId: string): Promise<CustomerPreferenceModel | null>;
  upsertPreferences(userId: string, data: Omit<CustomerPreferenceModel, 'updatedAt'>): Promise<CustomerPreferenceModel>;
}
