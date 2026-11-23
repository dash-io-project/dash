export interface AuthBootstrap {
  needsSetup: boolean;
  allowRegistration: boolean;
  allowedEmailDomains: string[];
}
