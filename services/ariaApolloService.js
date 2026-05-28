// Aria — Apollo API wrapper. Hits /v1/mixed_people/search and maps the
// response into our /Contacts schema. V1 caps at 100 results per call.

// New endpoint per Apollo's 2025 deprecation of /mixed_people/search.
// Docs: https://docs.apollo.io/reference/people-api-search
const APOLLO_URL = 'https://api.apollo.io/api/v1/mixed_people/api_search';
const PER_PAGE_CAP = 100;

export function isApolloConfigured() {
  return !!process.env.APOLLO_API_KEY;
}

// Params that the old /mixed_people/search endpoint accepted but the new
// /mixed_people/api_search endpoint silently zero-result-s on. Confirmed
// empirically by probing — `q_keywords: "Series B"` drops total_entries
// from ~1500 to 0 with no error response. Strip them defensively so a
// Claude hallucination here can't tank an otherwise good query.
const UNSUPPORTED_PARAMS = new Set([
  'q_keywords',
  'q_organization_keyword_tags',
]);

export async function searchPeople(params) {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    const e = new Error('Apollo API key not configured on server');
    e.code = 'APOLLO_NOT_CONFIGURED';
    throw e;
  }
  const sanitized = Object.fromEntries(
    Object.entries(params).filter(([k]) => !UNSUPPORTED_PARAMS.has(k)),
  );
  const body = { ...sanitized, per_page: Math.min(sanitized.per_page || PER_PAGE_CAP, PER_PAGE_CAP), page: 1 };
  const res = await fetch(APOLLO_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = new Error(json?.error || `Apollo returned ${res.status}`);
    e.code = 'APOLLO_HTTP_ERROR';
    e.status = res.status;
    e.payload = json;
    throw e;
  }
  return json || {};
}

const APOLLO_MATCH_URL = 'https://api.apollo.io/api/v1/people/match';
const APOLLO_ORG_SEARCH_URL = 'https://api.apollo.io/api/v1/organizations/search';

// Resolve a company name to an Apollo organization ID. Returns the best
// match — exact name (case-insensitive) preferred, then prefix match, then
// first result. Returns null if no match. mixed_companies/search returns
// wrong/clothing brands for short names; organizations/search is more
// accurate per empirical testing.
export async function resolveOrganizationByName(name) {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    const e = new Error('Apollo API key not configured on server');
    e.code = 'APOLLO_NOT_CONFIGURED';
    throw e;
  }
  const res = await fetch(APOLLO_ORG_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({ per_page: 10, q_organization_name: name }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    const e = new Error(json?.error || `Apollo org-search returned ${res.status}`);
    e.code = 'APOLLO_HTTP_ERROR';
    e.status = res.status;
    e.payload = json;
    throw e;
  }
  const json = await res.json();
  const orgs = json?.organizations || [];
  if (!orgs.length) return null;
  const q = name.trim().toLowerCase();
  const exact = orgs.find((o) => (o.name || '').toLowerCase() === q);
  if (exact) return exact;
  const startsWith = orgs.find((o) => (o.name || '').toLowerCase().startsWith(q));
  return startsWith || orgs[0];
}

// Reveal a single Apollo person. Costs 1 Apollo credit per call.
// Apollo returns the full person record with email + last_name + linkedin_url
// that the api_search response masks/omits. Use sparingly.
export async function revealApolloPerson(apolloPersonId) {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    const e = new Error('Apollo API key not configured on server');
    e.code = 'APOLLO_NOT_CONFIGURED';
    throw e;
  }
  const res = await fetch(APOLLO_MATCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({ id: apolloPersonId }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = new Error(json?.error || `Apollo /people/match returned ${res.status}`);
    e.code = 'APOLLO_HTTP_ERROR';
    e.status = res.status;
    e.payload = json;
    throw e;
  }
  // /people/match returns { person: {...} } most of the time, sometimes the
  // person at the top level. Normalize.
  return json?.person || json;
}

// Map an Apollo /v1/people/match response to a Contacts-doc patch.
// Captures the full set of fields we care about — person photo, headline,
// geo, seniority, social URLs, plus a nested `companyInfo` with the org
// data (logo, industry, headcount, revenue, etc.). Doesn't touch listIds,
// notes, source, verificationStatus.
export function mapApolloRevealToContactPatch(person) {
  if (!person) return null;
  const name =
    person.name ||
    [person.first_name, person.last_name].filter(Boolean).join(' ').trim() ||
    null;
  const email = (person.email || '').trim().toLowerCase() || null;
  const org = person.organization || person.account || null;
  const patch = pickDefined({
    // Identity
    name,
    firstName: person.first_name || null,
    lastName: person.last_name || null,
    email,
    emailStatus: person.email_status || null,
    emailConfidence: person.extrapolated_email_confidence || null,
    // Profile
    title: person.title || null,
    headline: person.headline || null,
    seniority: person.seniority || null,
    departments: arrOrNull(person.departments),
    subdepartments: arrOrNull(person.subdepartments),
    functions: arrOrNull(person.functions),
    photoUrl: person.photo_url || null,
    // Geo
    city: person.city || null,
    state: person.state || null,
    country: person.country || null,
    postalCode: person.postal_code || null,
    timeZone: person.time_zone || null,
    // Socials
    linkedinUrl: person.linkedin_url || null,
    twitterUrl: person.twitter_url || null,
    facebookUrl: person.facebook_url || null,
    githubUrl: person.github_url || null,
    // Intent (Apollo's buyer-intent score — paid feature)
    intentStrength: person.intent_strength || null,
    showIntent: person.show_intent ?? null,
    // Top-level company name kept for the table column
    company: org?.name || null,
    // Nested company detail
    companyInfo: org ? mapApolloOrgToCompanyInfo(org) : null,
    // Employment history — past roles, useful context for Aria's drafts.
    employmentHistory: Array.isArray(person.employment_history)
      ? person.employment_history.slice(0, 10).map((j) => ({
          organizationName: j.organization_name || j.organization?.name || null,
          title: j.title || null,
          startDate: j.start_date || null,
          endDate: j.end_date || null,
          current: !!j.current,
        }))
      : null,
  });
  return patch;
}

function mapApolloOrgToCompanyInfo(org) {
  return pickDefined({
    apolloId: org.id || null,
    name: org.name || null,
    domain: org.primary_domain || null,
    websiteUrl: org.website_url || null,
    logoUrl: org.logo_url || null,
    linkedinUrl: org.linkedin_url || null,
    twitterUrl: org.twitter_url || null,
    facebookUrl: org.facebook_url || null,
    crunchbaseUrl: org.crunchbase_url || null,
    angellistUrl: org.angellist_url || null,
    industry: org.industry || null,
    industries: arrOrNull(org.industries),
    secondaryIndustries: arrOrNull(org.secondary_industries),
    keywords: arrOrNull(org.keywords),
    estimatedEmployees: numOrNull(org.estimated_num_employees),
    revenue: numOrNull(org.organization_revenue),
    revenuePrinted: org.organization_revenue_printed || null,
    foundedYear: numOrNull(org.founded_year),
    shortDescription: org.short_description || null,
    city: org.city || null,
    state: org.state || null,
    country: org.country || null,
    postalCode: org.postal_code || null,
    streetAddress: org.street_address || null,
    primaryPhone: org.primary_phone?.number || org.primary_phone || org.phone || null,
    publiclyTradedExchange: org.publicly_traded_exchange || null,
    publiclyTradedSymbol: org.publicly_traded_symbol || null,
    alexaRanking: numOrNull(org.alexa_ranking),
  });
}

// Helper: drop keys whose value is null/undefined/empty so Firestore doesn't
// fill the doc with junk fields. Arrays of length 0 are dropped too.
function pickDefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out;
}
function arrOrNull(v) {
  if (!Array.isArray(v) || v.length === 0) return null;
  return v;
}
function numOrNull(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// Map an Apollo /v1/mixed_people/search person object to our /Contacts schema.
// Apollo people docs are nested — name, organization, etc. live at the top.
// Email is `email` or `email_status === 'verified'` + `email`.
export function mapApolloPersonToContact(person) {
  const name =
    person.name ||
    [person.first_name, person.last_name].filter(Boolean).join(' ').trim() ||
    null;
  const email = (person.email || '').trim().toLowerCase() || null;
  const linkedinUrl = person.linkedin_url || null;
  const org = person.organization || person.account || null;
  const company = org?.name || null;
  const title = person.title || null;
  const apolloPersonId = person.id || null;
  return {
    name,
    email,
    linkedinUrl,
    company,
    title,
    apolloPersonId,
  };
}
