import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY in environment');

const PHASE_TEMPLATES = {
  rewordField: `**Output JSON only**, exactly:
    {
      "rewordedField": "<Craft a single, conversational phrase that captures the user’s interests, combining related terms naturally (e.g. using “&” or “in”), and grouping sectors together. For example, if the user says “something in social media or influencer marketing. I love the beauty and fashion sectors,” you might output: “Social Media & Influencer Marketing in Fashion/Beauty”.>"
    }`,

  intro: `**Output JSON only**, exactly:
{
  "message": "Great! Let’s get started on building your profile. What type of position are you looking for? e.g. Social Media Manager, Marketing Intern, UX Designer, etc.",
  "memoryUpdate": { "phase": "askExperience", "careerField": "<FIELD_LABEL>" }
}`,
  askExperience: `**Output JSON only**, exactly:
{
  "message": "<Craft a single, conversational question that uses the user’s chosen field (<FIELD_LABEL>) you can summarize the chose field to make it conversational but ask if they’ve had any past jobs or internships in that area, and tell them to list only the company and their title. At the end of the question you could say, if not, that's okay we can move on.>",
  "memoryUpdate": { "phase": "experience" }
}`,
  experience: `**Output JSON only**, exactly:
{
  "experiences": [
    {
      "company": "<Company name>",
      "title": "<Job title>",
      "followUps": [
        {
          "id": "<uuid>",
          "question": "<Generate a single follow‑up question that elicits the key responsibilities or accomplishments for this <Job title> role at <Company name>.>"
        }
      ],
      "bullets": []
    }
  ],
  "memoryUpdate": { "phase": "askHighlights" }
}`,
  askHighlights: `**Output JSON only**, exactly:
{
  "message": "<Craft a warm, conversational prompt that uses the user’s chosen field (<FIELD_LABEL>) which you can generalize to invite them to share their top achievements or portfolio highlights from their classes or internships —phrased naturally, without simply pasting the field label. For example: “I’d love to hear about your standout wins or projects in that area—anything from internships to class work. What highlights can you share?”>",
  "memoryUpdate": { "phase": "firstFollowUp" }
}`,
  firstFollowUp: `**Output JSON only**, exactly:
{
  "message": "<One‑sentence professional summary of this role>",
  "memoryUpdate": {
    "experiences": [
      {
        "company": "<Company name>",
        "title": "<Job title>",
        "responsibilities": "<Original responsibilities>",
        "summary": "<Your new one‑sentence summary>",
        "followUps": [
          {
            "id": "<same uuid>",
            "question": "<Generate a single follow‑up question that asks further details about frequency or results or biggest wins based on the above responsibilities. The goal is to gather information to create a couple bullet points since this is a resume but these are college students so we're okay with it being broad or open ended.>"
          }
        ]
      }
    ]
  }
}`,
  bulletFollowUp: `**Output JSON only**, exactly:
{
  "message": "Thanks! Here are your bullet points.",
  "memoryUpdate": {
    "experiences": [
      {
        "company": "<Company name>",
        "title": "<Job title>",
        "responsibilities": "<Original responsibilities>",
        "summary": "<One‑sentence summary>",
        "followUps": [],
        "bullets": [
          "<Bullet point 1>",
          "<Bullet point 2>"
        ]
      }
    ]
  }
}`,

  highlights: `**Output JSON only**, exactly:
{
  "highlights": [
    {
      "title": "<A short, punchy headline>",
      "summary": "<A one‑sentence description expanding on that headline>"
    }
    // repeat one object per highlight the user provided
  ],
  "memoryUpdate": { "phase": "doneHighlights" }
}`,
};

function buildPrompt({ phase, userInput, memory, locationPath, followUpId }) {
  const header = [
    'You are Alix, an AI career advisor on Aply.com.',
    'Tone: Encouraging, concise; line breaks between advice and next questions.',
    `Location: User is on ${locationPath}.`,
  ].join('\n');

  let memCtx = '';
  if (memory.careerField) {
    memCtx += `Current field: ${memory.careerField}\n`;
  }
  if (Array.isArray(memory.experiences) && memory.experiences.length) {
    memCtx += `Experience: ${memory.experiences.map((e) => e.company).join(', ')}\n`;
    if (phase === 'firstFollowUp') {
      const targetForCtx = memory.experiences.find((exp) =>
        exp.followUps?.some((fq) => fq.id === followUpId)
      );
      if (targetForCtx?.responsibilities) {
        memCtx += `Responsibilities: ${targetForCtx.responsibilities}\n`;
      }
    }
  }

  let template = PHASE_TEMPLATES[phase] || PHASE_TEMPLATES.intro;

  if (
    (phase === 'firstFollowUp' || phase === 'bulletFollowUp') &&
    Array.isArray(memory.experiences)
  ) {
    const target = memory.experiences.find((exp) =>
      exp.followUps?.some((fq) => fq.id === followUpId)
    );
    const company = target?.company || '';
    const title = target?.title || '';
    const responsibilities = target?.responsibilities || '';

    template = template
      .replace(/<Original responsibilities>/g, responsibilities)
      .replace(/<Company name>/g, company)
      .replace(/<Job title>/g, title);
  }

  if (phase === 'askHighlights' || phase === 'highlights') {
    // no placeholder replacement needed beyond FIELD_LABEL
  }

  const promptBody = template.replace(/<FIELD_LABEL>/g, memory.careerField || 'this field');
  const parts = [header, memCtx];

  if (phase === 'firstFollowUp' || phase === 'bulletFollowUp') {
    parts.push(`FollowUpId: ${followUpId}`, `UserAnswer: ${userInput}`);
  }
  if (phase === 'highlights') {
    parts.push(`UserAnswer: ${userInput}`);
  }

  parts.push(promptBody);
  return parts.filter(Boolean).join('\n\n');
}

export async function generateAlixResponse({ phase, userInput, memory, locationPath, followUpId }) {
  const sysPrompt = buildPrompt({ phase, userInput, memory, locationPath, followUpId });
  const messages =
    phase === 'firstFollowUp' ||
    phase === 'bulletFollowUp' ||
    phase === 'askHighlights' ||
    phase === 'highlights'
      ? [{ role: 'system', content: sysPrompt }]
      : [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userInput },
        ];

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    { model: 'gpt-4o-mini', messages },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
    }
  );
  const aiText = response.data.choices[0].message.content;

  let out;
  try {
    out = JSON.parse(aiText);
  } catch (err) {
    console.error('AlixAIProfile JSON parse error:', aiText);
    const lastExp = (memory.experiences || []).slice(-1)[0] || {};
    return {
      message: userInput,
      memoryUpdate: {
        experiences: [
          {
            company: lastExp.company || '',
            title: lastExp.title || '',
            responsibilities: lastExp.responsibilities || '',
            summary: userInput,
            followUps: [
              {
                id: followUpId,
                question: `Based on your responsibilities (“${lastExp.responsibilities || ''}”), what accomplishments did you achieve in this role?`,
              },
            ],
          },
        ],
      },
    };
  }

  if (phase === 'firstFollowUp') {
    const exps = out.memoryUpdate?.experiences;
    if (Array.isArray(exps) && exps.length > 0) {
      const exp0 = exps[0];
      if (!Array.isArray(exp0.followUps) || exp0.followUps.length === 0) {
        const orig =
          memory.experiences.find((e) => e.company === exp0.company)?.responsibilities || '';
        exp0.followUps = [
          {
            id: followUpId,
            question: `Based on your responsibilities (“${orig}”), what 1–2 specific accomplishments or metrics did you achieve in this role?`,
          },
        ];
      }
    }
  }

  if (phase === 'bulletFollowUp') {
    const exps = out.memoryUpdate?.experiences;
    if (Array.isArray(exps) && exps.length) {
      const exp0 = exps[0];
      if (!Array.isArray(exp0.bullets) || exp0.bullets.length === 0) {
        out.memoryUpdate.experiences[0].bullets = [userInput];
      }
    }
  }
  if (phase === 'highlights') {
    // 1) If the AI didn’t return any highlights, split the raw user input
    if (!Array.isArray(out.highlights) || out.highlights.length === 0) {
      out.highlights = userInput
        .split(/[,;]\s*/)
        .map((h) => h.trim())
        .filter(Boolean)
        .map((text) => ({ title: text, summary: text }));
    }
    // 2) If it returned an array of strings (legacy), map them to objects
    else if (out.highlights.every((item) => typeof item === 'string')) {
      out.highlights = out.highlights.map((text) => ({ title: text, summary: text }));
    }
  }

  return out;
}
