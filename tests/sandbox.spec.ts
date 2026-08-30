import { test, expect } from '@playwright/test';

test('Sandbox Token Consumption Loop', async ({ page }) => {
  // 1. Navigate directly to /sandbox
  await page.goto('/sandbox');

  // 2. Click the "Simulate Nexus Login" button.
  await page.route('**/api/v1/health', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok' })
    });
  });

  await page.route('**/*passport.axim.us.com/*', async route => {
    await route.fulfill({ status: 200, body: 'mocked passport' });
  });

  const [request] = await Promise.all([
    page.waitForRequest(req => req.url().includes('passport.axim.us.com') && req.url().includes('redirect=')),
    page.click('text="Simulate Nexus Login"')
  ]);

  expect(request.url()).toContain('passport.axim.us.com');
  expect(request.url()).toContain('redirect=');

  await page.waitForLoadState('networkidle');

  // 3. Mock or intercept the return `?token=...` flow.
  await page.route('**/api/v1/auth/token/consume', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        valid: true,
        exp: Math.floor(Date.now() / 1000) + 3600,
        sub: 'usr_mock123',
        role: 'admin',
        supabase_access_token: 'fake.jwt.token'
      })
    });
  });

  // Navigate back to the sandbox with a fake token
  await page.goto('/sandbox?token=mock_token_123');

  // 4. Assert that the Sandbox UI correctly updates
  // The UI should display the "Authenticated" state when token is valid
  // and the data returned from consumeTokenAndCleanUrl (which contains sub, valid, exp, role)
  await expect(page.locator('text="Authentication Success!"')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('text="Verified: True"')).toBeVisible();

  // Checking that the JSON stringified result contains usr_mock123
  await expect(page.locator('pre')).toContainText('usr_mock123');

  // Checking that the Supabase auth state changes to Authenticated.
  const authState = page.locator('span', { hasText: 'Authenticated' }).first();
  await expect(authState).toBeVisible();
});
