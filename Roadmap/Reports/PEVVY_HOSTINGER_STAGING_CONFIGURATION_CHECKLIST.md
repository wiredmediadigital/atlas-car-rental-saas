# PEVVY Hostinger Staging Configuration Checklist

Status: planning only; Hostinger was not accessed or modified.

| Setting | Required value / verification |
|---|---|
| Repository | `wiredmediadigital/atlas-car-rental-saas` |
| Branch | `staging`, after first reviewed push |
| Framework | Vite |
| Node.js | 20.x, verify Hostinger compatibility |
| Root directory | `./` |
| Build command | `npm run build:staging` |
| Output directory | `dist-staging` |
| Hostname | `basic-brown-ostrich-10.hostingersite.com` |
| Browser Supabase URL | Approved `yeklucfthspvejlkffln` API origin only |
| Browser Supabase key | Publishable staging key only; never service-role/secret/DB credentials |
| Database credentials | Not supplied to the browser build or Hostinger frontend environment |
| Project identity | Verify bundle and browser requests do not reference production project |
| Deployment trigger | Confirm in Hostinger before GitHub connection; unknown from repository evidence |
| SSL | Verify certificate and HTTPS redirect on the staging hostname |
| Access protection | Configure/verify owner-approved staging access protection |
| Auth redirects | Add and verify the staging hostname in Supabase Auth redirect configuration through the approved staging control |
| SPA fallback | Verify direct navigation to application routes serves `index.html` |
| Rollback | Capture prior artifact/revision and prove Hostinger can restore it |

The current repository documents the live `main`/`pevvy.io` deployment, not a
verified isolated Hostinger staging Web App. The first Hostinger GitHub
connection may trigger a build; do not connect it until the branch, environment,
rollback, and access controls are confirmed.

## Release ordering

1. Approve and publish the isolated `staging` branch.
2. Review the ordered database migrations; do not assume Git publication applied them.
3. Separately authorize and apply staging migrations.
4. Configure and build the browser bundle with approved staging-only variables.
5. Deploy and validate the isolated Hostinger application.
6. Run browser/application acceptance with feature disabled first.
7. Explicitly activate one organization only after the STG-02 hosted contract passes.
