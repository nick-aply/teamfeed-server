// Aria — Claude API wrapper. Translates a plain-English target description
// into Apollo /v1/mixed_people/search params.
//
// Uses prompt caching on the system prompt (it's static and reused for every
// translation call). Returns null params + a clear errorMessage if the
// ANTHROPIC_API_KEY is missing — callers should bubble that as a 503.

import Anthropic from '@anthropic-ai/sdk';

const MODEL_ID = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You translate plain-English descriptions of a sales target audience into Apollo /v1/mixed_people/api_search query parameters.

OUTPUT FORMAT — return ONLY a single JSON object, no prose. Schema:
{
  "person_titles": string[]?,        // e.g. ["VP of Marketing", "Chief Marketing Officer"]
  "person_seniorities": string[]?,    // owner, founder, c_suite, partner, vp, head, director, manager, senior, entry, intern
  "person_locations": string[]?,      // "San Francisco, US", "California, US", "United States"
  "person_departments": string[]?,    // c_suite, marketing, sales, engineering, operations, finance, hr, product, design, legal, customer_success, information_technology
  "organization_names": string[]?,    // SPECIFIC company names the user named (e.g. ["Poppi","Olipop"]). Server resolves these to Apollo org IDs.
  "organization_locations": string[]?,
  "organization_industries": string[]?,
  "organization_num_employees_ranges": string[]?, // "1,10", "11,50", "51,200", "201,500", "501,1000", "1001,5000", "5001,10000", "10001+"
  "page": 1,
  "per_page": 100
}

COMPANY-NAME RULE (read carefully):
- If the description names specific companies — e.g. "at Poppi, Olipop, and Culture Pop", "at Stripe", "at Series B SaaS like Airtable" — put them in organization_names AS LITERAL NAMES, one per array element.
- Do NOT also include organization_industries or organization_num_employees_ranges when organization_names is set — the named companies are the filter. Adding industry/size on top can zero out the results if Apollo's record disagrees.
- Strip leading "the", trailing "Inc/LLC/Corp" before adding to the array.

CRITICAL — the new api_search endpoint does NOT accept free-text search:
- DO NOT emit "q_keywords", "q_organization_keyword_tags", or any q_* field. They silently zero-result the entire query.
- Map free-text signals into the closest concrete filter instead:
    "Series A"       → organization_num_employees_ranges: ["11,50"]
    "Series B"       → organization_num_employees_ranges: ["51,200"]
    "Series C/D"     → organization_num_employees_ranges: ["201,500"]
    "early-stage"    → organization_num_employees_ranges: ["1,10","11,50"]
    "enterprise"     → organization_num_employees_ranges: ["1001,5000","5001,10000","10001+"]
    "hiring SDRs"    → drop it (not expressible); narrower titles cover most of the intent
    "PLG / SaaS"     → organization_industries: ["computer software","saas","internet"]
    "B2B SaaS"       → organization_industries: ["computer software","saas"]
    "fintech"        → organization_industries: ["financial services","banking","investment management"]
    "healthcare"     → organization_industries: ["hospital & health care","health, wellness and fitness","medical practice"]

GUIDELINES:
- Prefer concrete title strings over loose seniorities. If a description says "CMOs", use person_titles: ["Chief Marketing Officer", "CMO"], not just seniority.
- Always set per_page: 100 and page: 1.
- Omit any field you can't infer with confidence. Smaller, more targeted queries beat broad ones — Aria can refine later.
- Never invent locations or industries. If the description is location-agnostic, omit those fields.

EXAMPLES:

User: "CMOs at Series B B2B SaaS companies hiring SDRs"
Output:
{"person_titles":["Chief Marketing Officer","CMO","VP of Marketing","Head of Marketing"],"organization_industries":["computer software","information technology and services","saas"],"organization_num_employees_ranges":["51,200"],"page":1,"per_page":100}

User: "Healthcare CROs in California, ops focused"
Output:
{"person_titles":["Chief Revenue Officer","CRO","VP of Revenue Operations","Head of Revenue Operations"],"organization_industries":["hospital & health care","health, wellness and fitness","medical practice"],"person_locations":["California, US"],"page":1,"per_page":100}

User: "Sorority presidents at Big Ten universities"
Output:
{"person_titles":["President","Chapter President"],"organization_industries":["higher education"],"page":1,"per_page":100}

User: "Social Media and marketing roles at Poppi, Olipop, and Culture Pop"
Output:
{"person_titles":["Social Media Manager","Social Media Coordinator","Social Media Specialist","Marketing Manager","Brand Manager","Community Manager","Content Manager"],"person_departments":["marketing"],"organization_names":["Poppi","Olipop","Culture Pop"],"page":1,"per_page":100}

User: "Engineers at Stripe"
Output:
{"person_titles":["Software Engineer","Senior Software Engineer","Staff Software Engineer","Engineering Manager"],"person_departments":["engineering"],"organization_names":["Stripe"],"page":1,"per_page":100}
`;

let _client = null;
function getClient() {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  _client = new Anthropic({ apiKey });
  return _client;
}

export function isAnthropicConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function translateToApolloParams(queryDescription) {
  const client = getClient();
  if (!client) {
    const e = new Error('Anthropic API key not configured on server');
    e.code = 'ANTHROPIC_NOT_CONFIGURED';
    throw e;
  }

  const response = await client.messages.create({
    model: MODEL_ID,
    max_tokens: 1024,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: queryDescription,
      },
    ],
  });

  const text =
    response.content?.find?.((c) => c.type === 'text')?.text ||
    (Array.isArray(response.content) ? response.content.map((c) => c.text || '').join('') : '');
  const params = parseJsonStrict(text);
  if (!params || typeof params !== 'object') {
    const e = new Error('Claude did not return JSON');
    e.code = 'CLAUDE_BAD_OUTPUT';
    e.raw = text;
    throw e;
  }
  // Defensive defaults — Apollo wants page + per_page.
  if (!params.page) params.page = 1;
  if (!params.per_page) params.per_page = 100;
  return params;
}

// Tolerant JSON parser — strips code fences, finds the first {...} block.
function parseJsonStrict(text) {
  if (!text) return null;
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}
