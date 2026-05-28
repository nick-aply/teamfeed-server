// Aria — Apollo API wrapper. Hits /v1/mixed_people/search and maps the
// response into our /Contacts schema. V1 caps at 100 results per call.

// New endpoint per Apollo's 2025 deprecation of /mixed_people/search.
// Docs: https://docs.apollo.io/reference/people-api-search
const APOLLO_URL = 'https://api.apollo.io/api/v1/mixed_people/api_search';
const PER_PAGE_CAP = 100;

export function isApolloConfigured() {
  return !!process.env.APOLLO_API_KEY;
}

export async function searchPeople(params) {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    const e = new Error('Apollo API key not configured on server');
    e.code = 'APOLLO_NOT_CONFIGURED';
    throw e;
  }
  const body = { ...params, per_page: Math.min(params.per_page || PER_PAGE_CAP, PER_PAGE_CAP), page: 1 };
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
