# AXiM Passport SDK Integration Guide

This guide details how to integrate the `@axim/passport-sdk` into your target application (e.g., Nexus CRM, Echo Recovery) to enable ecosystem Single Sign-On (SSO).

## 1. Install the SDK

Install the SDK directly from the Git repository:

```bash
npm install git+https://github.com/jimellars/axim-passport-sso-mgmt-app-6936.git
```

## 2. Redirect Unauthenticated Users to Passport Hub

When a user accesses your application without a valid session, redirect them to the AXiM Passport Hub for authentication.

You can use the `buildPassportRedirectUrl` utility provided by the SDK to correctly format the handoff URL.

```javascript
import { buildPassportRedirectUrl } from '@axim/passport-sdk';

// Determine your app's callback URL
const callbackUrl = `${window.location.origin}/auth/callback`;

// Build the redirect URL
const loginUrl = buildPassportRedirectUrl({
  passportUrl: 'https://passport.axim.com', // Replace with the actual AXiM Passport URL
  callbackUrl: callbackUrl,
});

// Redirect the user
window.location.href = loginUrl;
```

## 3. Handle the Returning Token

Once the user authenticates at the Passport Hub, they will be redirected back to your `callbackUrl` with a single-use token in the query string (`?token=...`).

You must consume this token to hydrate your Supabase session. The SDK provides a React hook, `usePassportHandoff`, which handles this automatically.

### Option A: Using the React Hook (Recommended)

In your callback component (or at the root of your app if you use the same path), use the `usePassportHandoff` hook. Ensure you pass your initialized Supabase client and the worker URL.

```javascript
import React, { useEffect } from 'react';
import { usePassportHandoff } from '@axim/passport-sdk';
import { supabase } from './your-supabase-client';

const AuthCallback = () => {
  const workerUrl = 'https://your-passport-edge-worker.workers.dev'; // Replace with actual worker URL

  const { loading, data, error } = usePassportHandoff({
    workerUrl,
    supabaseClient: supabase
  });

  if (loading) return <div>Authenticating...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      Success! You are now logged in.
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
};

export default AuthCallback;
```

### Option B: Using the Utility Function

If you are not using React or prefer manual control, you can use the `consumeTokenAndCleanUrl` function directly:

```javascript
import { consumeTokenAndCleanUrl } from '@axim/passport-sdk';
import { supabase } from './your-supabase-client';

const handleAuthHandoff = async () => {
  const workerUrl = 'https://your-passport-edge-worker.workers.dev';

  try {
    const data = await consumeTokenAndCleanUrl({
      workerUrl,
      supabaseClient: supabase
    });

    if (data && data.valid) {
      console.log('Successfully hydrated session.');
    }
  } catch (err) {
    console.error('Failed to consume token:', err);
  }
};
```

## Summary

1. User visits your application.
2. If unauthenticated, redirect them to `passport.axim.com` with `?redirect=YOUR_URL`.
3. User logs in to AXiM Passport.
4. User is redirected back to `YOUR_URL?token=YOUR_TOKEN`.
5. Your app uses `@axim/passport-sdk` to consume the token, hydrating your local Supabase session and cleaning the URL.
