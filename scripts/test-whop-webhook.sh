#!/bin/bash
# ------------------------------------------------------------------
# Test Whop webhook locally by sending signed payloads
# Usage: ./scripts/test-whop-webhook.sh [event_type] [base_url]
#
# Default base_url is http://localhost:3000
# Default event_type is payment.succeeded (PayGo)
#
# Examples:
#   ./scripts/test-whop-webhook.sh                              # PayGo payment.succeeded
#   ./scripts/test-whop-webhook.sh payment.succeeded             # PayGo payment
#   ./scripts/test-whop-webhook.sh membership.activated          # Pro subscription activated
#   ./scripts/test-whop-webhook.sh refund.created                # Refund
#   ./scripts/test-whop-webhook.sh payment.failed                # Payment failed
#   ./scripts/test-whop-webhook.sh membership.deactivated        # Pro deactivated
#   ./scripts/test-whop-webhook.sh payment.succeeded https://www.tranzkript.com   # Production
# ------------------------------------------------------------------

SECRET="ws_dacd187c1eeb71952816237d5345e0531e75561b564d0c97c6465486a8d0b364"
BASE_URL="${2:-http://localhost:3000}"
WEBHOOK_URL="$BASE_URL/api/whop/webhook"
EVENT_TYPE="${1:-payment.succeeded}"

# Generate unique IDs
EVENT_ID="test_$(date +%s)_$$"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

case "$EVENT_TYPE" in
  payment.succeeded)
    # PayGo purchase — $5 for 16 credits
    PRODUCT_ID="prod_WTi4DIKbKNdC5"
    PAYLOAD=$(cat <<EOF
{
  "id": "$EVENT_ID",
  "type": "payment.succeeded",
  "data": {
    "id": "pay_${EVENT_ID}",
    "product_id": "$PRODUCT_ID",
    "customer_email": "test@example.com",
    "amount": 500,
    "currency": "usd",
    "status": "succeeded",
    "created_at": "$TIMESTAMP"
  }
}
EOF
)
    echo "=== Testing: PayGo payment.succeeded ==="
    echo "Product: $PRODUCT_ID (\$5 — 16 credits)"
    echo "Customer: test@example.com"
    ;;

  membership.activated)
    # Pro subscription — 10 pods
    PRODUCT_ID="prod_NjbPeyYHSjrFJ"
    MEMBERSHIP_ID="mem_${EVENT_ID}"
    PAYLOAD=$(cat <<EOF
{
  "id": "$EVENT_ID",
  "type": "membership.activated",
  "data": {
    "id": "$MEMBERSHIP_ID",
    "product_id": "$PRODUCT_ID",
    "customer_email": "test@example.com",
    "membership": {
      "id": "$MEMBERSHIP_ID",
      "product_id": "$PRODUCT_ID",
      "user_email": "test@example.com",
      "status": "active",
      "created_at": "$TIMESTAMP"
    },
    "created_at": "$TIMESTAMP"
  }
}
EOF
)
    echo "=== Testing: Pro membership.activated ==="
    echo "Product: $PRODUCT_ID (10 pods)"
    echo "Customer: test@example.com"
    ;;

  membership.deactivated)
    # Pro subscription deactivated
    PRODUCT_ID="prod_NjbPeyYHSjrFJ"
    MEMBERSHIP_ID="mem_${EVENT_ID}"
    PAYLOAD=$(cat <<EOF
{
  "id": "$EVENT_ID",
  "type": "membership.deactivated",
  "data": {
    "id": "$MEMBERSHIP_ID",
    "product_id": "$PRODUCT_ID",
    "customer_email": "test@example.com",
    "membership": {
      "id": "$MEMBERSHIP_ID",
      "product_id": "$PRODUCT_ID",
      "user_email": "test@example.com",
      "status": "cancelled",
      "created_at": "$TIMESTAMP"
    },
    "created_at": "$TIMESTAMP"
  }
}
EOF
)
    echo "=== Testing: Pro membership.deactivated ==="
    echo "Product: $PRODUCT_ID"
    echo "Customer: test@example.com"
    ;;

  membership.cancel_at_period_end_changed)
    # Pro subscription cancelled (lapses at period end)
    PRODUCT_ID="prod_NjbPeyYHSjrFJ"
    MEMBERSHIP_ID="mem_${EVENT_ID}"
    PAYLOAD=$(cat <<EOF
{
  "id": "$EVENT_ID",
  "type": "membership.cancel_at_period_end_changed",
  "data": {
    "id": "$MEMBERSHIP_ID",
    "product_id": "$PRODUCT_ID",
    "customer_email": "test@example.com",
    "cancel_at_period_end": true,
    "membership": {
      "id": "$MEMBERSHIP_ID",
      "product_id": "$PRODUCT_ID",
      "user_email": "test@example.com",
      "cancel_at_period_end": true
    },
    "created_at": "$TIMESTAMP"
  }
}
EOF
)
    echo "=== Testing: Pro membership.cancel_at_period_end_changed (cancel) ==="
    echo "Product: $PRODUCT_ID"
    echo "Customer: test@example.com"
    ;;

  refund.created)
    # Refund for PayGo purchase
    PRODUCT_ID="prod_WTi4DIKbKNdC5"
    PAYLOAD=$(cat <<EOF
{
  "id": "$EVENT_ID",
  "type": "refund.created",
  "data": {
    "id": "ref_${EVENT_ID}",
    "product_id": "$PRODUCT_ID",
    "customer_email": "test@example.com",
    "amount": 500,
    "currency": "usd",
    "status": "succeeded",
    "created_at": "$TIMESTAMP"
  }
}
EOF
)
    echo "=== Testing: PayGo refund.created ==="
    echo "Product: $PRODUCT_ID (\$5 — 16 credits)"
    echo "Customer: test@example.com"
    ;;

  payment.failed)
    # Pro subscription payment failed
    PRODUCT_ID="prod_NjbPeyYHSjrFJ"
    PAYLOAD=$(cat <<EOF
{
  "id": "$EVENT_ID",
  "type": "payment.failed",
  "data": {
    "id": "pay_${EVENT_ID}",
    "product_id": "$PRODUCT_ID",
    "customer_email": "test@example.com",
    "amount": 170,
    "currency": "usd",
    "status": "failed",
    "created_at": "$TIMESTAMP"
  }
}
EOF
)
    echo "=== Testing: Pro payment.failed ==="
    echo "Product: $PRODUCT_ID"
    echo "Customer: test@example.com"
    ;;

  *)
    echo "Unknown event type: $EVENT_TYPE"
    echo "Valid types: payment.succeeded, membership.activated, membership.deactivated,"
    echo "             membership.cancel_at_period_end_changed, refund.created, payment.failed"
    exit 1
    ;;
esac

# Compute HMAC-SHA256 signature
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | cut -d' ' -f2)

echo ""
echo "Webhook URL: $WEBHOOK_URL"
echo "Event ID: $EVENT_ID"
echo "Signature: $SIGNATURE"
echo ""

# Send the webhook (single attempt, no pipe to avoid double-send)
RESPONSE=$(curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "x-whop-signature: $SIGNATURE" \
  -d "$PAYLOAD")
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

echo ""
echo "--- Done ---"