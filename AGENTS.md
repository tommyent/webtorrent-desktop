## Lessons

- Before pushing shared UI changes, run `CI=1 npm run test-integration` on macOS,
  review affected screenshots, and update their baselines. The audit UI test alone
  does not cover CI's visual comparisons.
