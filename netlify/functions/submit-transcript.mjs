// Receives a submitted transcript from the website and creates a page in the
// Notion "Transcript Entries" database. Written for Netlify Functions (V2,
// Web Standard Request/Response format).
//
// Required environment variables (Netlify -> Site configuration -> Environment variables):
//   NOTION_API_KEY              - secret from your Notion internal integration
//   NOTION_TRANSCRIPTS_DB_ID    - 7671babfd97b483c957c3be4ad7565bd (the Transcript Entries database)
//   NOTION_OPS_DASHBOARD_DB_ID  - 7e107e2403d44fcc989bda7a3e9dbabf (looks up the client's page id live)

async function findClientId(apiKey, opsDbId, clientName) {
  const resp = await fetch("https://api.notion.com/v1/databases/" + opsDbId + "/query", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      filter: { property: "Client", title: { equals: clientName } },
      page_size: 1
    })
  });
  const data = await resp.json();
  if (!resp.ok) return null;
  return data.results.length ? data.results[0].id : null;
}

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
  var NOTION_OPS_DASHBOARD_DB_ID = process.env.NOTION_OPS_DASHBOARD_DB_ID;

  if (!NOTION_API_KEY || !NOTION_TRANSCRIPTS_DB_ID || !NOTION_OPS_DASHBOARD_DB_ID) {
    return json({ error: "Missing NOTION_API_KEY, NOTION_TRANSCRIPTS_DB_ID, or NOTION_OPS_DASHBOARD_DB_ID" }, 500);
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

  var clientPageId = await findClientId(NOTION_API_KEY, NOTION_OPS_DASHBOARD_DB_ID, client);

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
