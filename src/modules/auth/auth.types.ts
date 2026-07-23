export type AuthenticatedPermission = {
  action: string;
  subject: string;
};

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string | null;
  roles: string[];
  permissions: AuthenticatedPermission[];
  mfaEnabled: boolean;
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
};
