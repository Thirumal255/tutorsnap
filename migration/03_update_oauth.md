# Step 3 — Update Google OAuth (manual, 2 minutes)

After the first deploy completes and you have the new Cloud Run URL, do this:

## 1. Add new Cloud Run URL to OAuth client

1. Go to: https://console.cloud.google.com/apis/credentials
   (Use your **original** Google account where OAuth was set up — this is NOT in GCP, it's in Google Cloud Console under the same project as your Google OAuth app)

2. Click your OAuth 2.0 Client ID

3. Under **Authorized redirect URIs**, add:
   ```
   https://YOUR_NEW_CLOUD_RUN_URL/auth/google/callback
   ```

4. Under **Authorized JavaScript origins**, add:
   ```
   https://YOUR_NEW_CLOUD_RUN_URL
   ```

5. Click **Save**

## 2. Update FRONTEND_URL secret in new project

Once the new Cloud Run URL is live:
```bash
NEW_URL="https://your-new-cloud-run-url.a.run.app"
echo -n "$NEW_URL" | gcloud secrets versions add FRONTEND_URL \
  --data-file=- \
  --project=YOUR_NEW_PROJECT_ID
```

## 3. Update frontend API URL

If your frontend has a hardcoded API URL, update it in the GitHub secret `VITE_API_URL`
or in `frontend/.env.production`:
```
VITE_API_URL=https://YOUR_NEW_CLOUD_RUN_URL
```

Then redeploy the frontend by pushing any change.
