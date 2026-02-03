#!/bin/bash
# Firebase Storage CORS Configuration Script
# Run this script to enable CORS for your Firebase Storage bucket

BUCKET="sticktomusic-c8b23.firebasestorage.app"

echo "🔧 Configuring CORS for Firebase Storage bucket: $BUCKET"
echo ""

# Check if gsutil is installed
if ! command -v gsutil &> /dev/null; then
    echo "❌ gsutil is not installed."
    echo ""
    echo "To install Google Cloud SDK:"
    echo "  macOS: brew install google-cloud-sdk"
    echo "  Or visit: https://cloud.google.com/sdk/docs/install"
    echo ""
    echo "After installing, run: gcloud auth login"
    exit 1
fi

# Check if authenticated
if ! gcloud auth list 2>&1 | grep -q "ACTIVE"; then
    echo "⚠️  Not authenticated with Google Cloud."
    echo "Running: gcloud auth login"
    gcloud auth login
fi

# Apply CORS configuration
echo "Applying CORS configuration..."
gsutil cors set cors.json gs://$BUCKET

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ CORS configured successfully!"
    echo ""
    echo "Your Firebase Storage bucket now allows cross-origin requests."
    echo "Video previews and audio beat detection should now work properly."
else
    echo ""
    echo "❌ Failed to configure CORS."
    echo "Make sure you have access to the Firebase project."
fi
