// api/client.ts and useSpeechToText.ts are plain modules, not React
// components, so they can't call Clerk's useAuth() hook directly. AuthBridge
// (rendered once inside <ClerkProvider>) registers its getToken here; both
// modules read through this indirection instead.
type GetToken = () => Promise<string | null>;

let currentGetToken: GetToken | undefined;

export function setTokenGetter(getToken: GetToken | undefined): void {
  currentGetToken = getToken;
}

export async function getAuthToken(): Promise<string | undefined> {
  if (!currentGetToken) return undefined;
  const token = await currentGetToken().catch(() => null);
  return token ?? undefined;
}
