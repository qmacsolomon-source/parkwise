# ParkWise Deployment Guide

## Desktop Console Deployment (Vercel)

### Prerequisites
- Vercel account (free)
- GitHub account (recommended)

### Steps

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/yourusername/parkwise.git
   git push -u origin main
   ```

2. **Deploy to Vercel**
   - Go to https://vercel.com
   - Click "Add New Project"
   - Import your GitHub repository
   - Set root directory to `desktop`
   - Add environment variables:
     - `VITE_SUPABASE_URL`: your Supabase project URL
     - `VITE_SUPABASE_ANON_KEY`: your Supabase anon key
   - Click "Deploy"

3. **Custom Domain (Optional)**
   - In Vercel project settings, go to Domains
   - Add your custom domain
   - Update DNS records as instructed

## Mobile App Deployment (Expo EAS)

### Prerequisites
- Expo account
- Apple Developer account ($99/year for iOS)
- Google Play Developer account ($25 one-time for Android)

### Steps

1. **Install EAS CLI**
   ```bash
   npm install -g eas-cli
   eas login
   ```

2. **Configure EAS**
   ```bash
   cd mobile
   eas build:configure
   ```

3. **Add Environment Variables**
   In `eas.json` or via EAS dashboard:
   ```json
   {
     "build": {
       "development": {
         "env": {
           "EXPO_PUBLIC_SUPABASE_URL": "your_url",
           "EXPO_PUBLIC_SUPABASE_ANON_KEY": "your_key"
         }
       },
       "preview": {
         "env": {
           "EXPO_PUBLIC_SUPABASE_URL": "your_url",
           "EXPO_PUBLIC_SUPABASE_ANON_KEY": "your_key"
         }
       },
       "production": {
         "env": {
           "EXPO_PUBLIC_SUPABASE_URL": "your_url",
           "EXPO_PUBLIC_SUPABASE_ANON_KEY": "your_key"
         }
       }
     }
   }
   ```

4. **Build for iOS**
   ```bash
   eas build --platform ios --profile production
   ```

5. **Build for Android**
   ```bash
   eas build --platform android --profile production
   ```

6. **Submit to Stores**
   - iOS: Use TestFlight for testing, then App Store Connect for production
   - Android: Upload to Google Play Console

## Supabase Production Checklist

### Security
- [ ] Enable email confirmation in Auth settings
- [ ] Enable phone verification (if using phone auth)
- [ ] Set up custom SMTP for emails
- [ ] Enable rate limiting on Auth
- [ ] Review and tighten RLS policies
- [ ] Enable database backups
- [ ] Set up point-in-time recovery

### Performance
- [ ] Enable database connection pooling
- [ ] Add indexes for frequently queried columns
- [ ] Enable query performance monitoring
- [ ] Set up database logging
- [ ] Configure cache headers for Storage

### Monitoring
- [ ] Enable Supabase logs
- [ ] Set up error tracking (Sentry)
- [ ] Configure uptime monitoring
- [ ] Set up alerts for database errors
- [ ] Monitor Realtime connection limits

### Backups
- [ ] Enable daily automated backups
- [ ] Test backup restoration
- [ ] Set up backup retention policy
- [ ] Document backup recovery process

## Environment Variables Management

### Development
Use `.env` files (gitignored):
```
desktop/.env
mobile/.env
```

### Production
Use platform-specific environment variables:
- **Vercel:** Project Settings > Environment Variables
- **Expo EAS:** EAS dashboard or eas.json
- **Supabase:** Project Settings > Environment Variables (for Edge Functions)

## CI/CD Pipeline (GitHub Actions)

### Example Workflow for Desktop

Create `.github/workflows/desktop.yml`:
```yaml
name: Desktop Build

on:
  push:
    branches: [main]
    paths:
      - 'desktop/**'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: cd desktop && npm ci
      - run: cd desktop && npm run build
      - uses: amondnet/vercel-action@v20
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          working-directory: ./desktop
```

### Example Workflow for Mobile

Create `.github/workflows/mobile.yml`:
```yaml
name: Mobile Build

on:
  push:
    branches: [main]
    paths:
      - 'mobile/**'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: cd mobile && npm ci
      - uses: expo/expo-github-action@v7
        with:
          eas-version: latest
          token: ${{ secrets.EXPO_TOKEN }}
```

## Database Migration Strategy

### Development
- Use Supabase SQL Editor for manual changes
- Keep SQL scripts in `database/` directory
- Document all schema changes

### Production
- Use Supabase Migrations (beta)
- Or use Supabase CLI for version control
- Test migrations on staging environment first
- Always backup before migrations

## Monitoring and Alerts

### Supabase Dashboard
- Monitor database size
- Track API usage
- Review auth logs
- Check Realtime connections

### Application Monitoring
- Add error tracking (Sentry, LogRocket)
- Monitor API response times
- Track user engagement
- Set up uptime monitoring

## Scaling Considerations

### Database
- Monitor connection pool usage
- Add read replicas if needed
- Consider partitioning large tables
- Optimize slow queries

### Realtime
- Monitor connection limits
- Implement reconnection logic
- Consider WebSocket load balancing
- Cache frequently accessed data

### Storage
- Monitor storage usage
- Implement CDN for assets
- Set up image optimization
- Clean up old files

## Cost Optimization

### Supabase
- Start with free tier (500MB database, 1GB bandwidth)
- Monitor usage to avoid overages
- Optimize database queries
- Clean up old data regularly

### Hosting
- Vercel free tier for desktop
- Consider VPS for cost savings at scale
- Use CDN for static assets
- Optimize bundle sizes

## Post-Deployment Checklist

- [ ] Test all user flows
- [ ] Verify authentication works
- [ ] Test real-time updates
- [ ] Check payment calculations
- [ ] Verify email notifications
- [ ] Test on multiple devices
- [ ] Monitor error logs
- [ ] Set up analytics
- [ ] Document API endpoints
- [ ] Create user documentation
- [ ] Set up support channels
