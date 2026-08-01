import { describe, expect, it } from 'vitest';

import { findSecurityAlertThresholdBreaches } from './securityAlertService';

describe('security alert thresholds', () => {
  it('emits only configured threshold breaches', () => {
    expect(findSecurityAlertThresholdBreaches([
      { event_type: 'AUTH_LOGIN_DENIED', total: 20 },
      { event_type: 'AUTHORIZATION_DENIED', total: 49 },
      { event_type: 'RATE_LIMITED', total: 21 },
      { event_type: 'UNKNOWN', total: 1000 },
    ])).toEqual([
      { eventType: 'AUTH_LOGIN_DENIED', total: 20, threshold: 20 },
      { eventType: 'RATE_LIMITED', total: 21, threshold: 20 },
    ]);
  });
});
