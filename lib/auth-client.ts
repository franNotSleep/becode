/**
 * The browser half of sign-in.
 *
 * Same-origin, so no baseURL: becode is served from one place and the cookie belongs to it.
 */
"use client";

import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({ plugins: [emailOTPClient()] });
