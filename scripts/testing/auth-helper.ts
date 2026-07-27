#!/usr/bin/env tsx

/**
 * Authentication Helper for Stress Tests
 *
 * Handles NextAuth authentication with retry/backoff and maintains
 * separate cookie jars per user for concurrent requests.
 */

import axios, { AxiosInstance } from "axios";
import * as https from "https";

export interface AuthSession {
    userId: string;
    email: string;
    client: AxiosInstance;
    cookies: string[];
    csrfToken: string;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const BASE_URL = process.env.NEXTAUTH_URL || "http://localhost:3000";

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry with exponential backoff
 */
async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = MAX_RETRIES,
    baseDelay: number = RETRY_DELAY_MS
): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;
            if (error.code === "ECONNREFUSED") {
                throw new Error(
                    `Cannot connect to server at ${BASE_URL}. Please ensure the Next.js server is running.`
                );
            }
            if (attempt < maxRetries - 1) {
                const delay = baseDelay * Math.pow(2, attempt);
                console.warn(
                    `[Auth] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`
                );
                await sleep(delay);
            }
        }
    }

    throw lastError || new Error("Retry failed");
}

/**
 * Extract cookies from Set-Cookie headers
 */
function extractCookies(headers: any): string[] {
    const cookies: string[] = [];
    const setCookieHeaders = headers["set-cookie"] || [];

    if (Array.isArray(setCookieHeaders)) {
        cookies.push(...setCookieHeaders);
    } else if (setCookieHeaders) {
        cookies.push(setCookieHeaders);
    }

    return cookies;
}

/**
 * Create axios instance with cookie support
 * @param cookies Array of cookie strings
 * @param timeout Timeout in milliseconds (default: 30 seconds, use longer for imports)
 */
function createAxiosClient(
    cookies: string[],
    timeout: number = 30000,
    csrfToken?: string
): AxiosInstance {
    // Format cookies properly - extract just the cookie name=value part
    const formattedCookies = cookies
        .map((cookie) => {
            // Extract name=value from "name=value; Path=/; HttpOnly" format
            const match = cookie.match(/^([^=]+=[^;]+)/);
            return match ? match[1] : cookie.split(";")[0].trim();
        })
        .filter((c) => c && c.length > 0);

    const cookieHeader = formattedCookies.join("; ");

    const instance = axios.create({
        baseURL: BASE_URL,
        withCredentials: true,
        headers: {
            Cookie: cookieHeader,
            "Content-Type": "application/json",
            ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
        httpsAgent: new https.Agent({
            rejectUnauthorized: false, // For self-signed certs in dev
        }),
        timeout,
    });

    // Initialize cookie map from formatted input cookies
    const cookieMap = new Map<string, string>();
    formattedCookies.forEach((c) => {
        const match = c.match(/^([^=]+)=([^;]+)/);
        if (match) cookieMap.set(match[1], match[2]);
    });

    // Add interceptor to update cookies from Set-Cookie header
    instance.interceptors.response.use((response) => {
        const setCookie = response.headers["set-cookie"];
        if (setCookie) {
            const newCookies = Array.isArray(setCookie) ? setCookie : [setCookie];
            let updated = false;

            newCookies.forEach((c) => {
                // Extract name=value
                const match = c.match(/^([^=]+)=([^;]+)/);
                if (match) {
                    cookieMap.set(match[1], match[2]);
                    updated = true;
                }
            });

            if (updated) {
                const newCookieHeader = Array.from(cookieMap.entries())
                    .map(([k, v]) => `${k}=${v}`)
                    .join("; ");

                // Update defaults for future requests
                instance.defaults.headers["Cookie"] = newCookieHeader;
                if (instance.defaults.headers.common) {
                    instance.defaults.headers.common["Cookie"] = newCookieHeader;
                }
            }
        }
        return response;
    });

    return instance;
}

/**
 * Authenticate a user and return session with client
 */
export async function authenticateUser(
    email: string,
    password: string,
    runId: string,
    userId: string
): Promise<AuthSession> {
    console.log(
        `[${runId}][${userId}] authenticateUser: Starting authentication for ${email}`
    );
    const authStartTime = Date.now();

    // Validate inputs before starting
    if (!email || typeof email !== "string" || email.trim().length === 0) {
        throw new Error(`Invalid email: ${JSON.stringify(email)}`);
    }
    if (
        !password ||
        typeof password !== "string" ||
        password.trim().length === 0
    ) {
        throw new Error(
            `Invalid password: password is ${password ? "set" : "missing"}`
        );
    }

    return retryWithBackoff(async () => {
        console.log(
            `[${runId}][${userId}] authenticateUser: Attempting login...`
        );
        // Create a shared axios instance that will maintain cookies
        const sharedClient = axios.create({
            baseURL: BASE_URL,
            withCredentials: true,
            httpsAgent: new https.Agent({
                rejectUnauthorized: false,
            }),
            timeout: 30000,
        });

        // Step 1: Get CSRF token
        const csrfResponse = await sharedClient.get("/api/auth/csrf");
        const csrfToken = csrfResponse.data?.csrfToken;
        if (!csrfToken) {
            throw new Error("Failed to get CSRF token");
        }

        // Debug: Verify user exists and can be found
        // (This is just for debugging - remove in production)
        try {
            const testResponse = await axios.get(
                `${BASE_URL}/api/auth/providers`,
                { httpsAgent: new https.Agent({ rejectUnauthorized: false }) }
            );
            if (!testResponse.data?.credentials) {
                throw new Error("Credentials provider not available");
            }
        } catch (error: any) {
            console.warn(
                `[${runId}][${userId}] Warning: Could not verify auth provider: ${error.message}`
            );
        }

        // Step 2: Login with credentials
        // Try test auth endpoint first (bypasses NextAuth for stress tests)
        let loginResponse;
        let useTestAuth = false;

        // Validate email and password before sending
        if (!email || !password) {
            throw new Error(
                `Missing credentials: email=${!!email}, password=${!!password}`
            );
        }

        console.log(
            `[${runId}][${userId}] authenticateUser: Attempting test auth login for ${email}...`
        );
        const loginPayload = {
            email: String(email),
            password: String(password),
        };
        console.log(
            `[${runId}][${userId}] authenticateUser: Login payload - email: "${email}" (type: ${typeof email}, length: ${email?.length || 0}), password: "${password.substring(0, 3)}***" (type: ${typeof password}, length: ${password?.length || 0})`
        );
        console.log(
            `[${runId}][${userId}] authenticateUser: Serialized payload: ${JSON.stringify(loginPayload)}`
        );

        try {
            const requestConfig = {
                headers: {
                    "Content-Type": "application/json",
                },
                validateStatus: (status: number) => {
                    // Log status for debugging
                    if (status >= 400) {
                        console.error(
                            `[${runId}][${userId}] authenticateUser: Test auth returned status ${status}`
                        );
                    }
                    return status < 400;
                },
            };

            console.log(
                `[${runId}][${userId}] authenticateUser: Making POST request to /api/test-auth/login with payload:`,
                loginPayload
            );
            loginResponse = await sharedClient.post(
                "/api/test-auth/login",
                loginPayload,
                requestConfig
            );

            console.log(
                `[${runId}][${userId}] authenticateUser: Test auth response status: ${loginResponse.status}, success: ${loginResponse.data?.success}`
            );

            if (loginResponse.status === 200 && loginResponse.data?.success) {
                useTestAuth = true;
                console.log(
                    `[${runId}][${userId}] Using test auth endpoint (bypasses NextAuth)`
                );
            } else {
                console.warn(
                    `[${runId}][${userId}] authenticateUser: Test auth returned ${loginResponse.status}, data: ${JSON.stringify(loginResponse.data).substring(0, 200)}`
                );
            }
        } catch (error: any) {
            console.error(
                `[${runId}][${userId}] authenticateUser: Test auth error:`,
                {
                    message: error.message,
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    data: error.response?.data,
                    config: {
                        url: error.config?.url,
                        method: error.config?.method,
                        data: error.config?.data,
                    },
                }
            );
            // Test auth endpoint not available or failed, fall back to NextAuth
            if (
                error.response?.status === 404 ||
                error.response?.status === 403
            ) {
                console.log(
                    `[${runId}][${userId}] Test auth not available, using NextAuth`
                );
                // Fall through to NextAuth flow
            } else if (error.response?.status === 401) {
                // 401 means credentials were rejected - log the error message
                const errorData = error.response?.data || {};
                const errorMsg =
                    errorData.error ||
                    errorData.message ||
                    "Invalid credentials";
                console.error(
                    `[${runId}][${userId}] Test auth failed (401): ${errorMsg}. ` +
                    `Response: ${JSON.stringify(errorData).substring(0, 200)}`
                );
                // Still fall through to NextAuth to try that
                console.log(
                    `[${runId}][${userId}] Falling back to NextAuth...`
                );
            } else {
                throw error;
            }
        }

        // If test auth didn't work, use NextAuth
        if (!useTestAuth) {
            loginResponse = await sharedClient.post(
                "/api/auth/callback/credentials",
                new URLSearchParams({
                    email,
                    password,
                    csrfToken: csrfToken,
                    callbackUrl: `${BASE_URL}/en/login`,
                    json: "true",
                }),
                {
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        "User-Agent":
                            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                        Accept: "application/json, text/plain, */*",
                        Referer: `${BASE_URL}/en/login`,
                    },
                    maxRedirects: 5,
                    validateStatus: (status) => status < 400,
                }
            );
        }

        // Ensure loginResponse is defined
        if (!loginResponse) {
            throw new Error(
                `Login failed: No response received from authentication endpoint`
            );
        }

        // Check if login failed (redirect to signin page indicates failure)
        if (
            loginResponse.data?.url &&
            typeof loginResponse.data.url === "string"
        ) {
            const url = loginResponse.data.url;
            if (url.includes("/api/auth/signin")) {
                // Extract error from URL if present
                const errorMatch = url.match(/[?&]error=([^&]+)/);
                const errorParam = errorMatch
                    ? decodeURIComponent(errorMatch[1])
                    : null;

                // Login failed - the authorize function likely rejected the credentials
                const errorMsg = errorParam
                    ? `Login failed: ${errorParam}`
                    : `Login failed: NextAuth redirected to signin page. ` +
                    `This usually means credentials were rejected. ` +
                    `Check: user exists, password matches, user is Active, user is not frozen.`;

                throw new Error(errorMsg);
            }
            // If URL is a success redirect (not to signin), that's good
        }

        // Check if login was successful
        // NextAuth callback endpoint returns 200 even on failure, so check the response data
        if (loginResponse.status >= 400) {
            const errorMsg =
                loginResponse.data?.error || `HTTP ${loginResponse.status}`;
            throw new Error(`Login failed: ${errorMsg}`);
        }

        // Check response data for errors (NextAuth might return error in data even with 200 status)
        if (loginResponse.data && typeof loginResponse.data === "object") {
            if (loginResponse.data.error) {
                throw new Error(`Login failed: ${loginResponse.data.error}`);
            }
            // Check for redirect URL which indicates success
            if (
                loginResponse.data.url &&
                loginResponse.data.url.includes("error")
            ) {
                throw new Error(`Login failed: ${loginResponse.data.url}`);
            }
        }

        // Log full response for debugging
        const responseData = loginResponse.data || {};
        console.log(
            `[${runId}][${userId}] Login response status: ${loginResponse.status}, ` +
            `data: ${JSON.stringify(responseData).substring(0, 300)}`
        );

        // Check for error in response
        if (responseData.error) {
            throw new Error(`Login failed: ${responseData.error}`);
        }

        // Check for error in URL
        if (responseData.url && responseData.url.includes("error=")) {
            const errorMatch = responseData.url.match(/error=([^&]+)/);
            const error = errorMatch
                ? decodeURIComponent(errorMatch[1])
                : "Unknown error";
            throw new Error(`Login failed: ${error}`);
        }

        // Extract cookies from response
        let cookies = extractCookies(loginResponse.headers);
        const uniqueCookies = Array.from(
            new Set(cookies.filter((c) => c && c.trim().length > 0))
        );

        // Check if we got the session cookie
        const hasSessionCookie = uniqueCookies.some(
            (c) =>
                c.includes("next-auth.session-token") ||
                c.includes("__Secure-next-auth.session-token")
        );

        if (useTestAuth) {
            // Test auth endpoint should have set the session cookie
            if (hasSessionCookie) {
                console.log(
                    `[${runId}][${userId}] Test auth successful, session cookie received`
                );
            } else {
                throw new Error(
                    "Test auth succeeded but no session cookie received"
                );
            }
        } else {
            // NextAuth flow
            if (uniqueCookies.length > 0) {
                console.log(
                    `[${runId}][${userId}] Login response: ${uniqueCookies.length} cookies, ` +
                    `session cookie: ${hasSessionCookie ? "YES" : "NO"}`
                );
            } else {
                console.warn(
                    `[${runId}][${userId}] Warning: No cookies in login response (status: ${loginResponse.status})`
                );
            }

            // If no session cookie, the login likely failed
            if (!hasSessionCookie && uniqueCookies.length > 0) {
                // We got cookies but not the session cookie - login might have failed
                console.warn(
                    `[${runId}][${userId}] No session cookie found. ` +
                    `Received cookies: ${uniqueCookies.map((c) => c.split(";")[0].split("=")[0]).join(", ")}`
                );
            }
        }

        // Step 2.5: Make a request to trigger session cookie creation
        // NextAuth might only set the session cookie on the first authenticated request
        try {
            // Try accessing a protected endpoint to trigger session creation
            await sharedClient.get("/api/auth/session", {
                validateStatus: (status) => status < 500, // Allow 401/403
            });
            // Re-extract cookies after session request
            const sessionCookies = extractCookies(
                (await sharedClient.get("/api/auth/csrf")).headers
            );
            cookies.push(...sessionCookies);
            const updatedCookies = Array.from(
                new Set(cookies.filter((c) => c && c.trim().length > 0))
            );
            if (updatedCookies.length > uniqueCookies.length) {
                uniqueCookies.push(
                    ...updatedCookies.filter((c) => !uniqueCookies.includes(c))
                );
            }
        } catch (error: any) {
            console.warn(
                `[${runId}][${userId}] Session trigger request failed: ${error.message}`
            );
        }

        // Small delay to ensure session is established
        await sleep(300);

        // Always use sharedClient for session verification - it maintains cookies automatically
        // Create a client with longer timeout for import operations (5 minutes)
        // Import operations can take a long time, especially with large files
        const IMPORT_TIMEOUT = 300000; // 5 minutes

        // Format cookies for the new client
        const formattedCookies = uniqueCookies
            .map((cookie) => {
                // Extract name=value from "name=value; Path=/; HttpOnly" format
                const match = cookie.match(/^([^=]+=[^;]+)/);
                return match ? match[1] : cookie.split(";")[0].trim();
            })
            .filter((c) => c && c.length > 0);
        const cookieHeaderValue = formattedCookies.join("; ");

        const client = axios.create({
            baseURL: BASE_URL,
            withCredentials: true,
            headers: {
                Cookie: cookieHeaderValue,
                "Content-Type": "application/json",
            },
            httpsAgent: new https.Agent({
                rejectUnauthorized: false,
            }),
            timeout: IMPORT_TIMEOUT, // Longer timeout for import operations
        });

        try {
            // Try test session endpoint first, fall back to NextAuth session
            let sessionResponse;
            let sessionUser = null;

            if (useTestAuth) {
                // For test auth, we already have the user data from login response
                // Just verify the session endpoint is accessible
                try {
                    sessionResponse = await client.get(
                        "/api/test-auth/session"
                    );
                    sessionUser = sessionResponse.data?.user;
                } catch (error: any) {
                    // If test session fails, use the user data from login response
                    if (loginResponse.data?.user) {
                        sessionUser = loginResponse.data.user;
                        console.log(
                            `[${runId}][${userId}] Using user data from login response (session endpoint unavailable)`
                        );
                    } else {
                        throw new Error(
                            "Test auth succeeded but no user data available"
                        );
                    }
                }
            } else {
                // NextAuth flow - use standard session endpoint
                sessionResponse = await client.get("/api/auth/session");
                sessionUser = sessionResponse.data?.user;
            }

            if (!sessionUser) {
                // For test auth, if session endpoint doesn't work, use login response data
                if (useTestAuth && loginResponse.data?.user) {
                    sessionUser = loginResponse.data.user;
                    console.log(
                        `[${runId}][${userId}] Using user data from login response (session verification skipped)`
                    );
                } else {
                    // Log the response for debugging
                    console.error(
                        `[${runId}][${userId}] Session response:`,
                        JSON.stringify(sessionResponse?.data || {}, null, 2)
                    );
                    throw new Error(
                        "Session verification failed: No user in session"
                    );
                }
            }

            // Verify the user matches
            if (sessionUser.email !== email) {
                throw new Error(
                    `Session verification failed: Email mismatch. Expected ${email}, got ${sessionUser.email}`
                );
            }
        } catch (error: any) {
            // If it's a connection error, provide better message
            if (error.code === "ECONNREFUSED") {
                throw new Error(
                    `Cannot connect to server at ${BASE_URL}. Please ensure the Next.js server is running.`
                );
            }
            throw new Error(
                `Session verification failed: ${error.message || "Unknown error"}`
            );
        }

        const authDuration = Date.now() - authStartTime;
        console.log(
            `[${runId}][${userId}] ✅ Authenticated user: ${email} (${uniqueCookies.length} cookies) in ${authDuration}ms`
        );

        // Create a client with cookies set in Cookie header for Node.js
        // Axios in Node.js doesn't automatically send cookies like browsers do
        const clientWithCookies =
            uniqueCookies.length > 0
                ? createAxiosClient(uniqueCookies, undefined, csrfToken)
                : client;

        return {
            userId,
            email,
            client: clientWithCookies,
            cookies: uniqueCookies,
            csrfToken,
        };
    });
}

/**
 * Authenticate multiple users concurrently
 */
export async function authenticateUsers(
    users: Array<{ email: string; password: string; userId: string }>,
    runId: string,
    maxConcurrency: number = 5
): Promise<Map<string, AuthSession>> {
    console.log(
        `[${runId}] authenticateUsers: Starting authentication for ${users.length} users with concurrency ${maxConcurrency}`
    );
    const sessions = new Map<string, AuthSession>();

    // Process authentication with concurrency limit
    const authPromises = users.map((user, index) => {
        console.log(
            `[${runId}] authenticateUsers: Queuing authentication ${index + 1}/${users.length} for ${user.email}`
        );
        return authenticateUser(user.email, user.password, runId, user.userId)
            .then((session) => {
                console.log(
                    `[${runId}] authenticateUsers: ✅ Successfully authenticated ${user.email}`
                );
                sessions.set(user.userId, session);
            })
            .catch((error) => {
                console.error(
                    `[${runId}] authenticateUsers: ❌ Failed to authenticate user ${user.email}:`,
                    error.message
                );
                throw error;
            });
    });

    // Process with concurrency limit
    console.log(
        `[${runId}] authenticateUsers: Processing ${authPromises.length} auth promises in batches of ${maxConcurrency}`
    );
    for (let i = 0; i < authPromises.length; i += maxConcurrency) {
        const batch = authPromises.slice(i, i + maxConcurrency);
        const batchNum = Math.floor(i / maxConcurrency) + 1;
        const totalBatches = Math.ceil(authPromises.length / maxConcurrency);
        console.log(
            `[${runId}] authenticateUsers: Processing batch ${batchNum}/${totalBatches} (${batch.length} users)...`
        );
        const batchStart = Date.now();
        await Promise.all(batch);
        const batchDuration = Date.now() - batchStart;
        console.log(
            `[${runId}] authenticateUsers: ✅ Batch ${batchNum} completed in ${batchDuration}ms`
        );
    }

    console.log(
        `[${runId}] authenticateUsers: ✅ All authentications completed. Total sessions: ${sessions.size}`
    );
    return sessions;
}

// Allow running as standalone script for testing
if (require.main === module) {
    const email = process.argv[2];
    const password = process.argv[3] || "TestPassword123!";
    const runId = process.argv[4] || `test-${Date.now()}`;
    const userId = process.argv[5] || "test-user";

    if (!email) {
        console.error(
            "Usage: auth-helper.ts <email> [password] [runId] [userId]"
        );
        process.exit(1);
    }

    authenticateUser(email, password, runId, userId)
        .then((session) => {
            console.log("\n✅ Authentication successful!");
            console.log(`User: ${session.email}`);
            console.log(`Cookies: ${session.cookies.length}`);
            process.exit(0);
        })
        .catch((error) => {
            console.error("❌ Authentication failed:", error.message);
            process.exit(1);
        });
}
