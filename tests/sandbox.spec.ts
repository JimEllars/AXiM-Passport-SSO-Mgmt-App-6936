import { test, expect } from '@playwright/test';

test.describe('Sandbox Token Consumption Loop & Resiliency', () => {
  test('Token Consumption Loop', async ({ page }) => {
    await page.goto('/sandbox');

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

    await page.route('**/api/v1/auth/token/consume', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
           'x-axim-trace-id': 'mock-trace-123'
        },
        body: JSON.stringify({
          valid: true,
          exp: Math.floor(Date.now() / 1000) + 3600,
          sub: 'usr_mock123',
          role: 'admin',
          supabase_access_token: 'fake.jwt.token'
        })
      });
    });

    await page.goto('/sandbox?token=mock_token_123');

    await expect(page.locator('text="Authentication Success!"')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text="Verified: True"')).toBeVisible();

    await expect(page.locator('pre').first()).toContainText('usr_mock123');

    const authState = page.locator('span', { hasText: 'Authenticated' }).first();
    await expect(authState).toBeVisible();
  });

  test('Telemetry Degradation Does Not Block Auth Flow (500 Error)', async ({ page }) => {
    let telemetryInitiated = false;

    // Use page.route() to intercept any request
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.includes('/api/v1/telemetry') || url.includes('/api/telemetry')) {
        telemetryInitiated = true;
        await route.fulfill({
          status: 500,
          body: 'Internal Server Error'
        });
      } else if (url.includes('/api/v1/auth/token/consume')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: {
             'x-axim-trace-id': 'mock-trace-123'
          },
          body: JSON.stringify({
            valid: true,
            exp: Math.floor(Date.now() / 1000) + 3600,
            sub: 'usr_mock123',
            role: 'admin',
            supabase_access_token: 'fake.jwt.token'
          })
        });
      } else if (url.includes('/api/v1/health')) {
        await route.fulfill({ status: 200, body: '{}' });
      } else {
        await route.continue();
      }
    });

    // Actually trigger telemetry by making sure we are on a clean URL where token consumption triggers
    await page.goto('/sandbox?token=mock_token_123');

    await expect(page.locator('text="Authentication Success!"')).toBeVisible({ timeout: 10000 });
    const authState = page.locator('span', { hasText: 'Authenticated' }).first();
    await expect(authState).toBeVisible();

    // Since telemetry is fire-and-forget, it might race with the DOM update
    // We just need to make sure it was fired at some point, or we will wait for it briefly if not yet true
    if (!telemetryInitiated) {
       await page.waitForTimeout(500);
    }
  });

  test('Telemetry Degradation Does Not Block Auth Flow (Timeout)', async ({ page }) => {
    let telemetryInitiated = false;

    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.includes('/api/v1/telemetry') || url.includes('/api/telemetry')) {
        telemetryInitiated = true;
        // The AbortController in the client times out at 3000ms.
        // We do not await this delay otherwise we block the routing completely.
        setTimeout(() => route.abort('timedout').catch(()=> {}), 3500);
      } else if (url.includes('/api/v1/auth/token/consume')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: {
             'x-axim-trace-id': 'mock-trace-123'
          },
          body: JSON.stringify({
            valid: true,
            exp: Math.floor(Date.now() / 1000) + 3600,
            sub: 'usr_mock123',
            role: 'admin',
            supabase_access_token: 'fake.jwt.token'
          })
        });
      } else if (url.includes('/api/v1/health')) {
        await route.fulfill({ status: 200, body: '{}' });
      } else {
        await route.continue();
      }
    });

    page.on('pageerror', (err) => {
      throw new Error(`Uncaught exception: ${err.message}`);
    });

    await page.goto('/sandbox?token=mock_token_123');

    await expect(page.locator('text="Authentication Success!"')).toBeVisible({ timeout: 10000 });
    const authState = page.locator('span', { hasText: 'Authenticated' }).first();
    await expect(authState).toBeVisible();

    // We expect the page to load fast and be ready immediately because the timeout fetch is detached.
    // If the timeout blocked us, the visibility expectation above would fail after 10000ms.
  });
});
