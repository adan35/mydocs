export interface Env {
  ROOM: DurableObjectNamespace;
  USER: DurableObjectNamespace;
  GOOGLE_CLIENT_ID: string;
  APP_ORIGINS: string;
  /** Secret: signs session tokens. */
  SESSION_SECRET: string;
  AI_PROVIDER: string;
  AI_MODEL: string;
  AI_MONTHLY_TOKENS: string;
  /** Secret: the owner's default AI key. Unset means the default key is off. */
  AI_API_KEY?: string;
  /** Local development only (`worker/.dev.vars`): lets tests sign in without Google. */
  DEV_AUTH?: string;
}
