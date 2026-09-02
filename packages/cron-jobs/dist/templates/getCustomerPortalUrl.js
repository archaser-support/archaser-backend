"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCustomerPortalUrl = getCustomerPortalUrl;
function getCustomerPortalUrl(customerUUID, sub_domain, customerLanguage, contactId, path) {
    if (!customerUUID)
        return "";
    const isLocalhost = process.env.NODE_ENV === "development";
    let baseUrl;
    const publicBaseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";
    const isStaging = publicBaseUrl.includes("staging.archaser.com");
    if (isLocalhost) {
        baseUrl = `http://localhost:${process.env.PORT || 3000}`;
    }
    else if (isStaging) {
        baseUrl = publicBaseUrl.endsWith("/")
            ? publicBaseUrl.slice(0, -1)
            : publicBaseUrl;
    }
    else if (sub_domain) {
        baseUrl = `https://${sub_domain}.archaser.com`;
    }
    else {
        baseUrl =
            process.env.NEXTAUTH_URL?.replace(/\/$/, "") ||
                "https://archaser.com";
    }
    let locale;
    if (customerLanguage === "Hebrew") {
        locale = "he";
    }
    else if (customerLanguage === "English") {
        locale = "en";
    }
    else if (customerLanguage === "he" || customerLanguage === "en") {
        locale = customerLanguage;
    }
    else {
        locale = "en";
    }
    let url = `${baseUrl}/${locale}/portal/${customerUUID}`;
    if (path) {
        const cleanPath = path.startsWith("/") ? path : `/${path}`;
        url += cleanPath;
    }
    const queryParams = [];
    if (contactId) {
        queryParams.push(`cid=${contactId}`);
    }
    if (queryParams.length > 0) {
        const separator = url.includes("?") ? "&" : "?";
        url += `${separator}${queryParams.join("&")}`;
    }
    return url;
}
