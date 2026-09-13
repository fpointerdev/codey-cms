export async function completeOwnerSetup(request, input) {
  try {
    await request("/install/complete", { method: "POST", body: JSON.stringify(input) });
  } catch (error) {
    // The transaction may have committed even when its response was lost.
    const status = await request("/install/status").catch(() => null);
    if (!status?.data?.installed) throw error;
  }
  try {
    const login = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: input.admin.email, password: input.admin.password })
    });
    return { installed: true, signedIn: Boolean(login.data?.tokens?.accessToken) };
  } catch {
    return { installed: true, signedIn: false };
  }
}
