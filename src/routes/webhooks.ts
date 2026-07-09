import { Router, Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import * as subscriptionService from '../services/subscriptionService';

const router = Router();

/**
 * POST /webhooks/revenuecat
 * Keeps profiles in sync on renewals, cancellations and expirations.
 *
 * Configure in RevenueCat → Project → Webhooks with an Authorization header
 * value matching REVENUECAT_WEBHOOK_AUTH. The event payload is only used for
 * the user id — entitlements are re-fetched from the RevenueCat API, so
 * out-of-order or replayed events cannot corrupt state.
 */
router.post('/revenuecat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (
      !env.revenuecat.webhookAuth ||
      req.headers.authorization !== env.revenuecat.webhookAuth
    ) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const appUserId: string | undefined = req.body?.event?.app_user_id;
    // RevenueCat anonymous ids ($RCAnonymousID:…) can't map to a profile row
    if (!appUserId || appUserId.startsWith('$RCAnonymousID')) {
      res.json({ success: true, skipped: true });
      return;
    }

    await subscriptionService.syncSubscription(appUserId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
