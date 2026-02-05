# Spotify Growth Attribution System

## Overview

The Spotify Growth Attribution system correlates your content posts (TikTok, Instagram, YouTube) with Spotify metrics (followers, track popularity) to identify which posts likely contributed to Spotify growth.

**IMPORTANT: Attribution shows correlation, not proven causation.** Use these insights directionally, not as absolute metrics.

## How It Works

### 1. Data Collection

The system collects two types of data:

**Spotify Data (via Spotify Web API)**
- Artist followers (total count)
- Artist popularity score (0-100)
- Track popularity scores (0-100)

**Content Posts (from Late.co)**
- Video metadata (views, likes, comments, shares)
- Engagement rates
- Linked songs
- Post timestamps

### 2. Snapshot System

Data is captured at regular intervals to enable delta calculations:

- **Artist snapshots**: Captured every 6 hours
- **Track snapshots**: Captured every 6 hours per track
- **Retention**: Last 90 days (360 snapshots per entity)

### 3. Growth Event Detection

A **growth event** is triggered when:

```
observed_delta > expected_delta + 1 standard_deviation
```

Where:
- `observed_delta` = actual metric change in last 24 hours
- `expected_delta` = rolling mean of prior 14 daily deltas (excluding last 48h and outliers with z > 2.5)

### 4. Attribution Algorithm

For each growth event, the system identifies candidate posts (posted within 96 hours before the event) and calculates:

#### Per-Post Relevance Score

```javascript
raw_relevance = engagement_quality × time_decay × song_match × platform_weight
```

**Engagement Quality (0-1):**
```javascript
engagement_quality =
  0.40 × normalized(views_24h) +
  0.25 × normalized(engagement_rate_24h) +
  0.20 × normalized(shares_24h || likes_24h) +
  0.15 × normalized(comments_24h)
```

**Time Decay:**
```javascript
time_decay = exp(-hours_since_post / 36)
```
Half-life of 36 hours - more recent posts get higher weight.

**Song Match:**
- 1.00 = Post's song matches the growth event's track
- 0.65 = Same artist, different track (or follower event with any song)
- 0.35 = No track mapping

**Platform Weight:**
- TikTok: 1.00
- Instagram: 0.85
- YouTube: 0.80
- Twitter/Facebook: 0.70
- Other: 0.65

#### Contribution Percentage

```javascript
contribution_pct = raw_relevance_post / sum(raw_relevance_all_candidates) × 100
```

#### Attributed Lift

```javascript
attributed_lift = lift_delta × contribution_pct / 100
```

Where `lift_delta = max(0, observed_delta - expected_delta)`

### 5. Confidence Scoring

Each attribution receives a confidence score (0-100):

```javascript
confidence = 100 × (
  0.45 × normalized(attributed_lift) +
  0.25 × engagement_quality +
  0.20 × time_decay +
  0.10 × song_match
)
```

**Penalties Applied:**
- More than 3 candidate posts: ×0.85
- Release day flag: ×0.85
- Paid campaign active: ×0.90

**Confidence Labels:**
- **High**: ≥ 70
- **Medium**: 45-69
- **Low**: < 45

## UI Components

### Overview Tab

1. **Spotify Momentum Card**
   - Current followers with 24h/7d deltas
   - Track momentum (average popularity change)
   - Momentum score (0-100)

2. **Growth Drivers Card**
   - Top 5 posts likely driving growth
   - Shows contribution %, confidence badge
   - Disclaimer about correlation vs causation

3. **Timeline Overlay Chart**
   - Follower growth curve
   - Content posts as event markers
   - Hover to see post details and attributed lift

### Songs Tab

Each song card shows:
- Spotify Momentum Score (if tracked)
- Total Attributed Lift (7d)
- Contributing videos

### Videos Tab

New columns:
- **Spotify Lift (7d)**: Attributed growth points
- **Contribution %**: This video's share of total lift
- **Confidence**: High/Medium/Low badge
- **Time to Impact**: Hours between post and growth event

### Spotify Tab

Full Spotify analytics with:
- Connection setup (Spotify Artist ID)
- Sync controls
- Detailed attribution tables
- Track-level breakdowns

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/spotify?action=getArtist` | Get Spotify artist data |
| `GET /api/spotify?action=getTrack` | Get Spotify track data |
| `GET /api/spotify?action=searchArtist` | Search for artists |
| `GET /api/spotify?action=getTopTracks` | Get artist's top tracks |
| `GET /api/spotify?action=validateArtist` | Validate Spotify Artist ID |
| `GET /api/spotify?action=getConfig` | Get saved Spotify config |
| `POST /api/spotify?action=saveConfig` | Save Spotify config |

## Environment Variables

```env
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
```

Get these from the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).

## Limitations

### Data Limitations

1. **No stream counts**: Spotify Web API only provides popularity scores (0-100), not actual stream counts. For stream data, consider integrating Spot On Track API (~$55/mo).

2. **6-hour granularity**: Snapshots are taken every 6 hours, so we can't detect growth events with finer resolution.

3. **14-day baseline**: Need at least 14 days of data to establish a reliable baseline for growth event detection.

### Attribution Limitations

1. **Correlation ≠ Causation**: The system shows statistical correlation, not proven causation. A post may appear to drive growth when the actual cause was something else (playlist placement, PR, etc.).

2. **Multi-factor attribution**: When multiple posts exist in the lookback window, attribution is distributed based on the algorithm—but reality may be that one post drove 100% of growth.

3. **External factors not captured**:
   - Playlist placements
   - PR/media coverage
   - Paid advertising
   - Viral moments outside tracked platforms
   - Algorithm changes

4. **Release day noise**: New releases typically get algorithmic boosts that aren't related to content performance.

### Best Practices

1. **Use directionally**: If a post shows 30% contribution with High confidence, it likely contributed to growth—but the exact percentage is uncertain.

2. **Look for patterns**: More valuable than single attributions is identifying patterns (e.g., "TikTok posts featuring Song X consistently correlate with growth spikes").

3. **Consider context**: A post with Low confidence might still have contributed if there were external factors that reduced confidence.

4. **Don't over-optimize**: Content quality matters more than gaming the attribution algorithm.

## Testing

Run tests:
```bash
npm test src/services/__tests__/spotifyAttributionService.test.js
```

Tests cover:
- Normalization functions
- Time decay calculations
- Song match scoring
- Platform weights
- Confidence scoring
- Attribution distribution (sums to 100%)
- Growth event detection

## Mock Data

For development/demo, seed mock data:

```javascript
import { seedSpotifyMockData } from './services/spotifyMockData';
seedSpotifyMockData('your_artist_id');
```

Clear mock data:
```javascript
import { clearSpotifyMockData } from './services/spotifyMockData';
clearSpotifyMockData('your_artist_id');
```

## Future Enhancements

1. **Spot On Track Integration**: Add actual stream counts for more accurate attribution
2. **Multi-artist comparison**: Compare attribution patterns across artists
3. **A/B testing**: Track content experiments with control groups
4. **Playlist tracking**: Attribute growth to playlist placements
5. **Machine learning**: Train models on historical data for better predictions
6. **Real-time alerts**: Notify when growth events are detected

---

*Built with ❤️ for StickToMusic*
