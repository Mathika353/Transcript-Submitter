// Receives a submitted transcript from the website and creates a page in the
// Notion "Transcript Entries" database. Written for Netlify Functions (V2,
// Web Standard Request/Response format).
//
// Required environment variables (Netlify -> Site configuration -> Environment variables):
//   NOTION_API_KEY             - secret from your Notion internal integration
//   NOTION_TRANSCRIPTS_DB_ID   - 7671babfd97b483c957c3be4ad7565bd (the Transcript Entries database)

var CLIENT_PAGE_IDS = {
  "Semida Repta": "3ab78d7c-4315-816f-9fe2-fbf83565a692",
  "Evelyn Kidonakis": "3ab78d7c-4315-8174-a395-d8e5e2d7d951",
  "Nick Gallegos": "3ab78d7c-4315-8102-8db1-d025bd9b416d",
  "Paul Diaz": "3ab78d7c-4315-8157-bec4-e2f8e5a733dd",
  "French Moore III": "3ab78d7c-4315-816b-93ae-d9fe4be2215f",
  "Bella Hanono": "3ab78d7c-4315-8136-b07a-ec8124dc3f5f",
  "Bryce Westmoreland": "3ab78d7c-4315-8164-a237-d8e0c2a95548",
  "Mark Streitz": "3ab78d7c-4315-81a4-bed3-cb8f6be3c4c4",
  "David Matney": "3ab78d7c-4315-81e5-b003-cf795ad4aa7f",
  "Drew Link": "3ab78d7c-4315-81e9-856e-e38a3d783488",
  "Praneeth Devabhaktuni": "3ab78d7c-4315-819f-acad-eb11ea03f0b9",
  "Varun Joseph": "3ab78d7c-4315-81bc-adf9-d3e3784a0e2f",
  "Jaime Davenport": "3ab78d7c-4315-8135-aeeb-fedd2fb6b189",
  "Christopher Calnon": "3ab78d7c-4315-814c-81a0-f0e732ad4c01",
  "Ben Alvarez": "3ab78d7c-4315-8187-8cfc-ff19a56c81d7",
  "Ethan Grounds": "3ab78d7c-4315-811d-8845-fc22334b287f",
  "Jim Albrecht": "3ab78d7c-4315-8150-84e2-d24e4d130a0c",
  "Ben Sirrine": "3ab78d7c-4315-811f-ab9a-dada7d71c129",
  "Lynne Thomas": "3ab78d7c-4315-8108-8f1b-f91449e0c32e",
  "Franklin A. Landers": "3ab78d7c-4315-8120-9c7d-e54f2cbd1df6",
  "Danny Bellamy": "3ab78d7c-4315-8162-ba14-cd153fe62374",
  "Michelle Lacues": "3ab78d7c-4315-815c-aa77-d636a1e40a5e",
  "Sundar Jagadeeshan": "3ab78d7c-4315-8192-8b66-c2e514a23ed8"
};

var NOTION_VERSION = "2022-06-28";

function chunkText(text, maxLen) {
  var chunks = [];
  var paragraphs = String(text || "").split(/\n+/);
  var current = "";

  paragraphs.forEach(function (p) {
    if (!p.trim()) return;

    if (p.length > maxLen) {
      if (current) { chunks.push(current); current = ""; }
      for (var i = 0; i < p.length; i += maxLen) {
        chunks.push(p.slice(i, i + maxLen));
      }
      return;
    }

    var candidate = current ? current + "\n" + p : p;
    if (candidate.length > maxLen) {
      if (current) chunks.push(current);
      current = p;
    } else {
      current = candidate;
    }
  });

  if (current) chunks.push(current);
  return chunks;
}

function paragraphBlock(text) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: [{ type: "text", text: { content: text } }] }
  };
}

function headingBlock(text) {
  return {
    object: "block",
    type: "heading_2",
    heading_2: { rich_text: [{ type: "text", text: { content: text } }] }
  };
}

function dividerBlock() {
  return { object: "block", type: "divider", divider: {} };
}

async function notionRequest(apiKey, path, method, body) {
  var resp = await fetch("https://api.notion.com/v1" + path, {
    method: method,
    headers: {
      Authorization: "Bearer " + apiKey,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  var data = await resp.json();
  if (!resp.ok) {
    var err = new Error("Notion API error: " + (data.message || resp.status));
    err.detail = data;
    throw err;
  }
  return data;
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Use POST" }, 405);
  }

  var NOTION_API_KEY = process.env.NOTION_API_KEY;
  var NOTION_TRANSCRIPTS_DB_ID = process.env.NOTION_TRANSCRIPTS_DB_ID;

  if (!NOTION_API_KEY || !NOTION_TRANSCRIPTS_DB_ID) {
    return json({ error: "Missing NOTION_API_KEY or NOTION_TRANSCRIPTS_DB_ID" }, 500);
  }

  var body;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: "Request body was not valid JSON" }, 400);
  }

  var client = String(body.client || "").trim();
  var meetingDate = String(body.meetingDate || "").trim();
  var meetingType = String(body.meetingType || "Other").trim();
  var submittedBy = String(body.submittedBy || "").trim();
  var transcript = String(body.transcript || "").trim();

  if (!client || !meetingDate || !submittedBy || !transcript) {
    return json({ error: "client, meetingDate, submittedBy, and transcript are all required" }, 400);
  }

  var clientPageId = CLIENT_PAGE_IDS[client];

  try {
    var meetingTitle = client + " \u2014 " + meetingType + " \u2014 " + meetingDate;

    var properties = {
      "Meeting Title": { title: [{ text: { content: meetingTitle } }] },
      "Meeting Date": { date: { start: meetingDate } },
      "Meeting Type": { select: { name: meetingType } },
      "Submitted By": { rich_text: [{ text: { content: submittedBy } }] }
    };
    if (clientPageId) {
      properties["Client"] = { relation: [{ id: clientPageId }] };
    }

    var transcriptChunks = chunkText(transcript, 1900).map(paragraphBlock);
    var firstBatchBlocks = [dividerBlock(), headingBlock("Full Transcript")];

    var remainingCapacity = Math.max(100 - firstBatchBlocks.length, 0);
    var firstTranscriptSlice = transcriptChunks.slice(0, remainingCapacity);
    var restTranscript = transcriptChunks.slice(firstTranscriptSlice.length);

    firstBatchBlocks = firstBatchBlocks.concat(firstTranscriptSlice);

    var page = await notionRequest(NOTION_API_KEY, "/pages", "POST", {
      parent: { database_id: NOTION_TRANSCRIPTS_DB_ID },
      properties: properties,
      children: firstBatchBlocks
    });

    for (var i = 0; i < restTranscript.length; i += 100) {
      var batch = restTranscript.slice(i, i + 100);
      await notionRequest(NOTION_API_KEY, "/blocks/" + page.id + "/children", "PATCH", { children: batch });
    }

    return json({
      message: "Saved to Notion",
      pageUrl: page.url,
      summarized: false
    });
  } catch (err) {
    console.error(err);
    return json({ error: err.message, detail: err.detail || null }, 500);
  }
};
