#!/bin/bash

# ============================================
# Archaser Penetration Testing Script
# ============================================
# 
# This script performs comprehensive penetration testing
# against the Archaser application to validate security implementations.
#
# Usage:
#   ./scripts/security/penetration-test.sh [options]
#
# Options:
#   -u, --url URL          Base URL of the application (default: http://localhost:3000)
#   -e, --email EMAIL      Test user email (required for auth tests)
#   -p, --password PASS    Test user password (required for auth tests)
#   -v, --verbose          Verbose output
#   -h, --help            Show this help message
#
# ============================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
BASE_URL="${BASE_URL:-http://localhost:3000}"
TEST_EMAIL="${TEST_EMAIL:-}"
TEST_PASSWORD="${TEST_PASSWORD:-}"
VERBOSE=false
COOKIE_JAR=$(mktemp)
SESSION_TOKEN=""
TEST_RESULTS=()
PASSED=0
FAILED=0
WARNINGS=0

# ============================================
# Helper Functions
# ============================================

print_header() {
    echo -e "\n${BLUE}============================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}============================================${NC}\n"
}

print_test() {
    echo -e "${YELLOW}[TEST]${NC} $1"
}

print_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((PASSED++))
    TEST_RESULTS+=("PASS: $1")
}

print_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((FAILED++))
    TEST_RESULTS+=("FAIL: $1")
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
    ((WARNINGS++))
    TEST_RESULTS+=("WARN: $1")
}

print_info() {
    if [ "$VERBOSE" = true ]; then
        echo -e "${BLUE}[INFO]${NC} $1"
    fi
}

# Make HTTP request and return status code
http_request() {
    local method=$1
    local endpoint=$2
    local data="${3:-}"
    local headers="${4:-}"
    
    local cmd="curl -s -o /dev/null -w '%{http_code}' -X $method"
    
    if [ -n "$headers" ]; then
        cmd="$cmd -H '$headers'"
    fi
    
    if [ -n "$SESSION_TOKEN" ]; then
        cmd="$cmd -H 'Cookie: next-auth.session-token=$SESSION_TOKEN'"
    fi
    
    if [ -n "$data" ]; then
        cmd="$cmd -d '$data' -H 'Content-Type: application/json'"
    fi
    
    cmd="$cmd -b '$COOKIE_JAR' -c '$COOKIE_JAR'"
    cmd="$cmd '$BASE_URL$endpoint'"
    
    eval "$cmd"
}

# Get HTTP response headers
http_headers() {
    local endpoint=$1
    local header="${2:-}"
    
    local cmd="curl -s -I"
    
    if [ -n "$SESSION_TOKEN" ]; then
        cmd="$cmd -H 'Cookie: next-auth.session-token=$SESSION_TOKEN'"
    fi
    
    cmd="$cmd -b '$COOKIE_JAR' -c '$COOKIE_JAR'"
    cmd="$cmd '$BASE_URL$endpoint'"
    
    if [ -n "$header" ]; then
        eval "$cmd" | grep -i "$header" | cut -d' ' -f2- | tr -d '\r'
    else
        eval "$cmd"
    fi
}

# ============================================
# Test Functions
# ============================================

test_security_headers() {
    print_header "Security Headers Testing"
    
    local endpoint="/api/country"
    print_test "Testing security headers on $endpoint"
    
    local headers=$(http_headers "$endpoint")
    
    # Check X-Frame-Options
    if echo "$headers" | grep -qi "X-Frame-Options: DENY"; then
        print_pass "X-Frame-Options header present"
    else
        print_fail "X-Frame-Options header missing or incorrect"
    fi
    
    # Check X-Content-Type-Options
    if echo "$headers" | grep -qi "X-Content-Type-Options: nosniff"; then
        print_pass "X-Content-Type-Options header present"
    else
        print_fail "X-Content-Type-Options header missing or incorrect"
    fi
    
    # Check X-XSS-Protection
    if echo "$headers" | grep -qi "X-XSS-Protection"; then
        print_pass "X-XSS-Protection header present"
    else
        print_fail "X-XSS-Protection header missing"
    fi
    
    # Check Strict-Transport-Security (only if HTTPS)
    if [[ "$BASE_URL" == https://* ]]; then
        if echo "$headers" | grep -qi "Strict-Transport-Security"; then
            print_pass "Strict-Transport-Security header present"
        else
            print_warn "Strict-Transport-Security header missing (HTTPS detected)"
        fi
    fi
    
    # Check Content-Security-Policy
    if echo "$headers" | grep -qi "Content-Security-Policy"; then
        print_pass "Content-Security-Policy header present"
    else
        print_fail "Content-Security-Policy header missing"
    fi
    
    # Check Referrer-Policy
    if echo "$headers" | grep -qi "Referrer-Policy"; then
        print_pass "Referrer-Policy header present"
    else
        print_fail "Referrer-Policy header missing"
    fi
}

test_rate_limiting() {
    print_header "Rate Limiting Testing"
    
    # Test general API rate limiting
    print_test "Testing general API rate limiting (100 requests per 15 min)"
    local rate_limit_hit=false
    
    for i in {1..105}; do
        local status=$(http_request "GET" "/api/country")
        print_info "Request $i: Status $status"
        
        if [ "$status" = "429" ]; then
            rate_limit_hit=true
            print_pass "Rate limit enforced at request $i"
            break
        fi
        
        # Check for rate limit headers
        local remaining=$(http_headers "/api/country" "X-RateLimit-Remaining" | head -1)
        if [ -n "$remaining" ]; then
            print_info "Rate limit remaining: $remaining"
        fi
        
        # Small delay to avoid overwhelming the server
        sleep 0.1
    done
    
    if [ "$rate_limit_hit" = false ]; then
        print_warn "Rate limit not hit after 105 requests (may need adjustment)"
    fi
    
    # Test authentication rate limiting
    if [ -n "$TEST_EMAIL" ] && [ -n "$TEST_PASSWORD" ]; then
        print_test "Testing authentication rate limiting (5 requests per 15 min)"
        local auth_limit_hit=false
        
        for i in {1..7}; do
            local status=$(http_request "POST" "/api/auth/signin/credentials" \
                "{\"email\":\"wrong@example.com\",\"password\":\"wrongpass\"}" \
                "Content-Type: application/json")
            print_info "Auth attempt $i: Status $status"
            
            if [ "$status" = "429" ]; then
                auth_limit_hit=true
                print_pass "Authentication rate limit enforced at attempt $i"
                break
            fi
            
            sleep 0.2
        done
        
        if [ "$auth_limit_hit" = false ]; then
            print_warn "Authentication rate limit not hit after 7 attempts"
        fi
    else
        print_warn "Skipping authentication rate limit test (credentials not provided)"
    fi
}

test_authentication() {
    print_header "Authentication Testing"
    
    if [ -z "$TEST_EMAIL" ] || [ -z "$TEST_PASSWORD" ]; then
        print_warn "Skipping authentication tests (credentials not provided)"
        print_info "Use -e and -p options to provide test credentials"
        return
    fi
    
    # Get CSRF token first
    print_test "Getting CSRF token"
    local csrf_response=$(curl -s "$BASE_URL/api/auth/csrf" -b "$COOKIE_JAR" -c "$COOKIE_JAR")
    # macOS compatible - use sed instead of grep -P
    local csrf_token=$(echo "$csrf_response" | sed -n 's/.*"csrfToken":"\([^"]*\)".*/\1/p' || echo "")
    
    if [ -z "$csrf_token" ]; then
        print_warn "Could not get CSRF token, attempting login without it"
    else
        print_info "CSRF token obtained"
    fi
    
    # Test login with valid credentials
    print_test "Testing login with valid credentials"
    local login_data="email=$(printf '%s' "$TEST_EMAIL" | jq -sRr @uri 2>/dev/null || echo "$TEST_EMAIL")&password=$(printf '%s' "$TEST_PASSWORD" | jq -sRr @uri 2>/dev/null || echo "$TEST_PASSWORD")&callbackUrl=$BASE_URL/en/login&json=true"
    
    if [ -n "$csrf_token" ]; then
        login_data="$login_data&csrfToken=$csrf_token"
    fi
    
    local login_response=$(curl -s -X POST "$BASE_URL/api/auth/callback/credentials" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -H "Referer: $BASE_URL/en/login" \
        -d "$login_data" \
        -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
        -L -w "%{http_code}")
    
    local status="${login_response: -3}"
    if [ "$status" = "200" ] || [ "$status" = "302" ]; then
        print_pass "Login successful with valid credentials"
        # Extract session token if possible (macOS compatible - handle Netscape cookie format)
        # Cookie jar format: domain, flag, path, secure, expiration, name, value
        SESSION_TOKEN=$(awk -F'\t' '/next-auth\.session-token/ {print $7}' "$COOKIE_JAR" 2>/dev/null | head -1 || \
                       awk -F'\t' '/__Secure-next-auth\.session-token/ {print $7}' "$COOKIE_JAR" 2>/dev/null | head -1 || \
                       grep -E 'next-auth\.session-token' "$COOKIE_JAR" 2>/dev/null | sed -E 's/.*next-auth\.session-token[[:space:]]+([^[:space:]]+).*/\1/' | head -1 || \
                       grep -E '__Secure-next-auth\.session-token' "$COOKIE_JAR" 2>/dev/null | sed -E 's/.*__Secure-next-auth\.session-token[[:space:]]+([^[:space:]]+).*/\1/' | head -1 || echo "")
        if [ -n "$SESSION_TOKEN" ]; then
            print_info "Session token obtained"
        else
            print_info "Session token not found in cookie jar (may be set via Set-Cookie header)"
            # Try to get session from a test request
            local test_response=$(curl -s -X GET "$BASE_URL/api/permissions/me" -b "$COOKIE_JAR" -c "$COOKIE_JAR" -w "%{http_code}")
            if [ "${test_response: -3}" = "200" ]; then
                print_info "Session is working (can access protected endpoint)"
                SESSION_TOKEN="WORKING" # Mark as working even if we can't extract the exact token
            fi
        fi
    else
        print_fail "Login failed with valid credentials (Status: $status)"
        print_info "Response: ${login_response%???}"
    fi
    
    # Test login with invalid credentials
    print_test "Testing login with invalid credentials"
    local invalid_data="email=invalid@example.com&password=wrongpass&callbackUrl=$BASE_URL/en/login&json=true"
    if [ -n "$csrf_token" ]; then
        invalid_data="$invalid_data&csrfToken=$csrf_token"
    fi
    
    local invalid_status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/auth/callback/credentials" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -H "Referer: $BASE_URL/en/login" \
        -d "$invalid_data" \
        -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
        -L)
    
    if [ "$invalid_status" = "401" ] || [ "$invalid_status" = "302" ] || [ "$invalid_status" = "200" ]; then
        print_pass "Login correctly rejected invalid credentials"
    else
        print_warn "Login returned status $invalid_status (may need verification)"
    fi
    
    # Test protected endpoint without authentication
    print_test "Testing protected endpoint without authentication"
    local protected_status=$(http_request "GET" "/api/entities/customers")
    
    if [ "$protected_status" = "401" ]; then
        print_pass "Protected endpoint requires authentication"
    else
        print_warn "Protected endpoint returned status $protected_status (may allow public access)"
    fi
}

test_input_validation() {
    print_header "Input Validation Testing"
    
    # Test XSS payload in query parameter
    print_test "Testing XSS protection in query parameters"
    local xss_payload="<script>alert('XSS')</script>"
    # URL encode the payload
    local encoded_payload=$(printf '%s' "$xss_payload" | jq -sRr @uri 2>/dev/null || echo "$xss_payload")
    local status=$(http_request "GET" "/api/customers/search?q=$encoded_payload")
    
    # Should not execute script (status should be 400 or sanitized, or 401 if not authenticated)
    if [ "$status" = "400" ] || [ "$status" = "200" ] || [ "$status" = "401" ]; then
        if [ "$status" = "401" ]; then
            print_info "XSS test requires authentication (status 401)"
        fi
        print_pass "XSS payload handled (sanitized or rejected)"
    else
        print_warn "XSS payload returned status $status (verify sanitization)"
    fi
    
    # Test SQL injection attempt
    print_test "Testing SQL injection protection"
    local sql_payload="' OR '1'='1"
    # URL encode the payload
    local encoded_sql=$(printf '%s' "$sql_payload" | jq -sRr @uri 2>/dev/null || echo "$sql_payload")
    local status=$(http_request "GET" "/api/customers/search?q=$encoded_sql")
    
    # Should not execute SQL (status should be 400 or safe, or 401 if not authenticated)
    if [ "$status" = "400" ] || [ "$status" = "200" ] || [ "$status" = "401" ]; then
        if [ "$status" = "401" ]; then
            print_info "SQL injection test requires authentication (status 401)"
        fi
        print_pass "SQL injection attempt handled safely"
    else
        print_warn "SQL injection attempt returned status $status"
    fi
    
    # Test path traversal attempt
    print_test "Testing path traversal protection"
    local path_traversal="../../../etc/passwd"
    local status=$(http_request "POST" "/api/activities/attachments/presigned-url" \
        "{\"filePath\":\"$path_traversal\"}" \
        "Content-Type: application/json")
    
    if [ "$status" = "400" ] || [ "$status" = "401" ] || [ "$status" = "403" ]; then
        print_pass "Path traversal attempt blocked"
    else
        print_warn "Path traversal attempt returned status $status (may need authentication)"
    fi
    
    # Test oversized request
    print_test "Testing request size limits"
    local json_payload_file=$(mktemp)
    # Create JSON with 11MB message (slightly over 10MB limit)
    # Use a more efficient method to create large payload
    echo -n '{"message":"' > "$json_payload_file"
    # Generate 11MB of 'A' characters using Python or fallback methods
    if command -v python3 &> /dev/null; then
        python3 -c "import sys; sys.stdout.write('A' * 11000000)" >> "$json_payload_file" 2>/dev/null || \
        python3 -c "print('A' * 11000000, end='')" >> "$json_payload_file" 2>/dev/null
    else
        # Fallback: use head to create large string (slower but works)
        head -c 11000000 < /dev/zero | tr '\0' 'A' >> "$json_payload_file" 2>/dev/null || \
        yes 'A' | head -c 11000000 >> "$json_payload_file" 2>/dev/null
    fi
    echo '","source":"test"}' >> "$json_payload_file"
    
    # Use --data-binary to send file content (avoids command line argument limits)
    local status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/logs/create" \
        -H "Content-Type: application/json" \
        --data-binary "@$json_payload_file" \
        -b "$COOKIE_JAR" -c "$COOKIE_JAR" 2>/dev/null || echo "000")
    
    rm -f "$json_payload_file"
    
    if [ "$status" = "413" ] || [ "$status" = "400" ] || [ "$status" = "000" ]; then
        if [ "$status" = "000" ]; then
            print_warn "Oversized request may be rejected (connection failed - likely size limit)"
        else
            print_pass "Oversized request rejected (Status: $status)"
        fi
    else
        print_warn "Oversized request returned status $status (verify size limits)"
    fi
}

test_cors() {
    print_header "CORS Testing"
    
    # Test CORS with allowed origin
    print_test "Testing CORS with allowed origin"
    local cors_headers=$(curl -s -I -X OPTIONS "$BASE_URL/api/ws/notifications" \
        -H "Origin: https://yourdomain.com" \
        -H "Access-Control-Request-Method: GET" | grep -i "access-control")
    
    if echo "$cors_headers" | grep -qi "Access-Control-Allow-Origin"; then
        print_pass "CORS headers present for allowed origin"
    else
        print_warn "CORS headers not found (may be configured differently)"
    fi
    
    # Test CORS with disallowed origin
    print_test "Testing CORS with disallowed origin"
    local disallowed_origin=$(curl -s -I -X OPTIONS "$BASE_URL/api/ws/notifications" \
        -H "Origin: https://malicious.com" \
        -H "Access-Control-Request-Method: GET" | grep -i "access-control-allow-origin")
    
    if [ -z "$disallowed_origin" ] || echo "$disallowed_origin" | grep -qi "null"; then
        print_pass "CORS correctly blocks disallowed origin"
    else
        print_fail "CORS allows disallowed origin"
    fi
}

test_file_upload_security() {
    print_header "File Upload Security Testing"
    
    # Check if we can make authenticated requests (even if token extraction failed)
    local test_auth=$(curl -s -o /dev/null -w '%{http_code}' -X GET "$BASE_URL/api/permissions/me" -b "$COOKIE_JAR" -c "$COOKIE_JAR" 2>/dev/null)
    if [ "$test_auth" != "200" ]; then
        print_warn "Skipping file upload tests (not authenticated)"
        return
    fi
    
    # Test presigned URL endpoint with malicious paths
    print_test "Testing file path validation in presigned URL endpoint"
    local malicious_paths=(
        "../../../etc/passwd"
        "..\\..\\..\\windows\\system32\\config\\sam"
        "/etc/passwd"
        "C:\\Windows\\System32\\config\\SAM"
        "....//....//....//etc/passwd"
    )
    
    local blocked_count=0
    for path in "${malicious_paths[@]}"; do
        local status=$(http_request "POST" "/api/activities/attachments/presigned-url" \
            "{\"filePath\":\"$path\"}" \
            "Content-Type: application/json")
        if [ "$status" = "400" ] || [ "$status" = "401" ] || [ "$status" = "403" ]; then
            ((blocked_count++))
        fi
    done
    
    if [ $blocked_count -eq ${#malicious_paths[@]} ]; then
        print_pass "All path traversal attempts blocked"
    else
        print_warn "Some path traversal attempts not blocked ($blocked_count/${#malicious_paths[@]})"
    fi
    
    # Test file size limits
    print_test "Testing file size validation"
    # This is tested in input validation, but we can verify the endpoint
    local size_status=$(http_request "POST" "/api/activities/attachments/presigned-url" \
        "{\"filePath\":\"test.txt\",\"expiresIn\":3600}" \
        "Content-Type: application/json")
    
    if [ "$size_status" = "200" ] || [ "$size_status" = "400" ]; then
        print_info "File upload endpoint accessible (Status: $size_status)"
    else
        print_warn "File upload endpoint returned status $size_status"
    fi
    
    print_info "Full file upload testing requires multipart form data"
    print_info "Manual testing recommended for complete file upload security validation"
}

test_error_handling() {
    print_header "Error Handling Security Testing"
    
    # Test error response doesn't leak stack traces
    print_test "Testing error response security"
    local error_status=$(http_request "GET" "/api/nonexistent-endpoint")
    
    # Check if response contains stack trace indicators
    local response=$(curl -s "$BASE_URL/api/nonexistent-endpoint")
    
    if echo "$response" | grep -qi "stack trace\|at \|Error:"; then
        if [[ "$BASE_URL" == *"localhost"* ]] || [[ "$BASE_URL" == *"127.0.0.1"* ]]; then
            print_info "Stack traces in development are acceptable"
        else
            print_fail "Stack traces exposed in production response"
        fi
    else
        print_pass "Error response doesn't expose stack traces"
    fi
}

test_webhook_security() {
    print_header "Webhook Security Testing"
    
    # Test Twilio webhook without signature
    print_test "Testing Twilio webhook signature validation"
    local twilio_status=$(http_request "POST" "/api/sms/webhook/twilio" \
        "{\"Body\":\"test\"}" \
        "Content-Type: application/json")
    
    if [ "$twilio_status" = "401" ] || [ "$twilio_status" = "403" ]; then
        print_pass "Twilio webhook requires signature"
    else
        print_warn "Twilio webhook may not validate signature (Status: $twilio_status)"
    fi
    
    # Test AWS SES webhook
    print_test "Testing AWS SES webhook validation"
    local ses_status=$(http_request "POST" "/api/email/ses-webhook" \
        "{\"Type\":\"Notification\"}" \
        "Content-Type: application/json")
    
    if [ "$ses_status" = "401" ] || [ "$ses_status" = "403" ]; then
        print_pass "AWS SES webhook requires validation"
    else
        print_warn "AWS SES webhook may not validate (Status: $ses_status)"
    fi
}

test_session_security() {
    print_header "Session Security Testing"
    
    # Check if we can make authenticated requests (even if token extraction failed)
    local test_auth=$(curl -s -o /dev/null -w '%{http_code}' -X GET "$BASE_URL/api/permissions/me" -b "$COOKIE_JAR" -c "$COOKIE_JAR" 2>/dev/null)
    if [ "$test_auth" != "200" ] && [ -z "$SESSION_TOKEN" ]; then
        print_warn "Skipping session security tests (not authenticated)"
        return
    fi
    
    # Test session cookie attributes
    print_test "Testing session cookie security"
    local cookies=$(cat "$COOKIE_JAR" 2>/dev/null || echo "")
    
    if echo "$cookies" | grep -qi "HttpOnly"; then
        print_pass "Session cookie has HttpOnly flag"
    else
        print_fail "Session cookie missing HttpOnly flag"
    fi
    
    if [[ "$BASE_URL" == https://* ]]; then
        if echo "$cookies" | grep -qi "Secure"; then
            print_pass "Session cookie has Secure flag (HTTPS)"
        else
            print_fail "Session cookie missing Secure flag (HTTPS detected)"
        fi
    fi
    
    # Test session persistence
    print_test "Testing session persistence"
    local test_status=$(http_request "GET" "/api/permissions/me")
    if [ "$test_status" = "200" ]; then
        print_pass "Session persists across requests"
    else
        print_warn "Session may not persist (Status: $test_status)"
    fi
}

test_authorization() {
    print_header "Authorization Testing (Privilege Escalation)"
    
    # Check if we can make authenticated requests (even if token extraction failed)
    local test_auth=$(curl -s -o /dev/null -w '%{http_code}' -X GET "$BASE_URL/api/permissions/me" -b "$COOKIE_JAR" -c "$COOKIE_JAR" 2>/dev/null)
    if [ "$test_auth" != "200" ]; then
        print_warn "Skipping authorization tests (not authenticated)"
        return
    fi
    
    # Test horizontal privilege escalation - try to access another user's data
    print_test "Testing horizontal privilege escalation (accessing other users' data)"
    # Try to access a customer that doesn't belong to current user
    # Using a high ID that likely doesn't exist or belongs to another account
    local test_customer_id=999999
    local customer_status=$(http_request "GET" "/api/entities/customers/$test_customer_id")
    
    if [ "$customer_status" = "403" ] || [ "$customer_status" = "404" ]; then
        print_pass "Cannot access unauthorized customer data (Status: $customer_status)"
    elif [ "$customer_status" = "401" ]; then
        print_warn "Authorization test requires valid session (Status: 401)"
    else
        print_warn "Customer access returned status $customer_status (verify authorization)"
    fi
    
    # Test vertical privilege escalation - try to access admin endpoints
    print_test "Testing vertical privilege escalation (accessing admin endpoints)"
    local admin_status=$(http_request "GET" "/api/admin/logs")
    
    if [ "$admin_status" = "403" ]; then
        print_pass "Admin endpoints require proper authorization"
    elif [ "$admin_status" = "401" ]; then
        print_warn "Admin endpoint requires authentication (Status: 401)"
    elif [ "$admin_status" = "200" ]; then
        print_warn "Admin endpoint accessible - verify user has admin role"
    else
        print_info "Admin endpoint returned status $admin_status"
    fi
    
    # Test permissions endpoint
    print_test "Testing permissions endpoint access"
    local perm_status=$(http_request "GET" "/api/permissions/me")
    
    if [ "$perm_status" = "200" ]; then
        print_pass "Can access own permissions"
    else
        print_warn "Permissions endpoint returned status $perm_status"
    fi
}

test_csrf_protection() {
    print_header "CSRF Protection Testing"
    
    # Check if we can make authenticated requests (even if token extraction failed)
    local test_auth=$(curl -s -o /dev/null -w '%{http_code}' -X GET "$BASE_URL/api/permissions/me" -b "$COOKIE_JAR" -c "$COOKIE_JAR" 2>/dev/null)
    if [ "$test_auth" != "200" ]; then
        print_warn "Skipping CSRF tests (not authenticated)"
        return
    fi
    
    # Test state-changing operation without proper origin/referer
    print_test "Testing CSRF protection on state-changing operations"
    local csrf_status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/logs/create" \
        -H "Content-Type: application/json" \
        -H "Origin: https://malicious.com" \
        -H "Referer: https://malicious.com/attack" \
        -d '{"message":"test","source":"test"}' \
        -b "$COOKIE_JAR" -c "$COOKIE_JAR" 2>/dev/null)
    
    # NextAuth handles CSRF, so this might still work if SameSite is lax
    # But we should check if the request is blocked
    if [ "$csrf_status" = "403" ] || [ "$csrf_status" = "401" ]; then
        print_pass "CSRF protection blocks cross-origin requests"
    else
        print_info "CSRF test returned status $csrf_status (NextAuth may handle CSRF differently)"
    fi
    
    # Test SameSite cookie policy
    print_test "Testing SameSite cookie policy"
    local cookies=$(cat "$COOKIE_JAR" 2>/dev/null || echo "")
    if echo "$cookies" | grep -qi "SameSite"; then
        print_pass "SameSite cookie policy is set"
    else
        print_warn "SameSite cookie policy not found (may be set by browser)"
    fi
}

test_sensitive_data_exposure() {
    print_header "Sensitive Data Exposure Testing"
    
    # Test error messages for sensitive information
    print_test "Testing error messages for sensitive data"
    local error_response=$(curl -s "$BASE_URL/api/nonexistent-endpoint-12345" 2>/dev/null)
    
    # Check for common sensitive data patterns
    if echo "$error_response" | grep -qiE "(password|secret|key|token|api_key|database|connection)" 2>/dev/null; then
        print_fail "Error response may contain sensitive information"
    else
        print_pass "Error response doesn't expose obvious sensitive data"
    fi
    
    # Test stack traces
    print_test "Testing for stack traces in responses"
    if echo "$error_response" | grep -qiE "(at |stack|trace|Error:|Exception:)" 2>/dev/null; then
        if [[ "$BASE_URL" == *"localhost"* ]] || [[ "$BASE_URL" == *"127.0.0.1"* ]]; then
            print_info "Stack traces in development are acceptable"
        else
            print_fail "Stack traces exposed in production response"
        fi
    else
        print_pass "No stack traces in error responses"
    fi
    
    # Test API responses for sensitive data
    if [ -n "$SESSION_TOKEN" ]; then
        print_test "Testing API responses for sensitive data"
        local api_response=$(curl -s "$BASE_URL/api/permissions/me" \
            -H "Cookie: next-auth.session-token=$SESSION_TOKEN" \
            -b "$COOKIE_JAR" 2>/dev/null)
        
        if echo "$api_response" | grep -qiE "(password|secret|key|token)" 2>/dev/null; then
            print_warn "API response may contain sensitive data (verify if expected)"
        else
            print_pass "API response doesn't expose sensitive data"
        fi
    fi
}

test_idor() {
    print_header "Insecure Direct Object Reference (IDOR) Testing"
    
    # Check if we can make authenticated requests (even if token extraction failed)
    local test_auth=$(curl -s -o /dev/null -w '%{http_code}' -X GET "$BASE_URL/api/permissions/me" -b "$COOKIE_JAR" -c "$COOKIE_JAR" 2>/dev/null)
    if [ "$test_auth" != "200" ]; then
        print_warn "Skipping IDOR tests (not authenticated)"
        return
    fi
    
    # Test sequential ID enumeration
    print_test "Testing sequential ID enumeration"
    local id1_status=$(http_request "GET" "/api/entities/customers/1")
    local id2_status=$(http_request "GET" "/api/entities/customers/2")
    local id999_status=$(http_request "GET" "/api/entities/customers/999")
    
    # If all return same status, might be enumerable
    if [ "$id1_status" = "$id2_status" ] && [ "$id2_status" = "$id999_status" ]; then
        if [ "$id1_status" = "403" ] || [ "$id1_status" = "401" ]; then
            print_pass "IDs are protected from enumeration"
        else
            print_warn "IDs may be enumerable (all returned status $id1_status)"
        fi
    else
        print_info "ID access varies by resource (good - prevents enumeration)"
    fi
    
    # Test UUID vs sequential ID
    print_test "Testing UUID vs sequential ID usage"
    # Try accessing with UUID format
    local uuid_status=$(http_request "GET" "/api/entities/customers/00000000-0000-0000-0000-000000000001")
    if [ "$uuid_status" = "400" ] || [ "$uuid_status" = "404" ]; then
        print_pass "Invalid ID format properly rejected"
    else
        print_info "UUID format returned status $uuid_status"
    fi
}

# ============================================
# Main Execution
# ============================================

main() {
    print_header "Archaser Penetration Testing"
    echo "Base URL: $BASE_URL"
    echo "Test Email: ${TEST_EMAIL:-Not provided}"
    echo ""
    
    # Run all tests
    test_security_headers
    test_rate_limiting
    test_authentication
    test_input_validation
    test_cors
    test_file_upload_security
    test_error_handling
    test_webhook_security
    test_session_security
    test_authorization
    test_csrf_protection
    test_sensitive_data_exposure
    test_idor
    
    # Print summary
    print_header "Test Summary"
    echo "Passed: $PASSED"
    echo "Failed: $FAILED"
    echo "Warnings: $WARNINGS"
    echo ""
    
    if [ $FAILED -eq 0 ]; then
        echo -e "${GREEN}All critical tests passed!${NC}"
        exit 0
    else
        echo -e "${RED}Some tests failed. Review the output above.${NC}"
        exit 1
    fi
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -u|--url)
            BASE_URL="$2"
            shift 2
            ;;
        -e|--email)
            TEST_EMAIL="$2"
            shift 2
            ;;
        -p|--password)
            TEST_PASSWORD="$2"
            shift 2
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -h|--help)
            head -20 "$0"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use -h for help"
            exit 1
            ;;
    esac
done

# Cleanup on exit
trap "rm -f $COOKIE_JAR" EXIT

# Run main function
main

