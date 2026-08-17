// Serves the current client list live from Notion's Client Ops Dashboard —
// no hardcoded array to keep in sync. Add a client via the Client Intake
// tool and it shows up here automatically on next page load.
//
// Required environment variables:
//   NOTION_API_KEY              - same integration token used by the other TD Coaching tools
//   NOTION_OPS_DASHBOARD_DB_ID  - 7e107e2403d44fcc989bda7a3e9dbabf

const NOTION_VERSION = "2022-06-28";

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

function plainTitle(prop) {
  if (!prop || !prop.title) return "";
  return prop.title.map((t) => t.plain_text).join("");
}

export default async () => {
  const NOTION_API_KEY = process.env.NOTION_API_KEY;
  const OPS_DB = process.env.NOTION_OPS_DASHBOARD_DB_ID;

  if (!NOTION_API_KEY || !OPS_DB) {
    return json({ configured: false, names: [] });
  }

  try {
    let names = [];
    let cursor = undefined;
    let hasMore = true;
    let pages = 0;

    while (hasMore && pages < 10) {
      const resp = await fetch("https://api.notion.com/v1/databases/" + OPS_DB + "/query", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + NOTION_API_KEY,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          page_size: 100,
          start_cursor: cursor,
          sorts: [{ property: "Client", direction: "ascending" }]
        })
      });
      const data = await resp.json();
      if (!resp.ok) {
        return json({ configured: true, error: data.message, names: [] }, 200);
      }
      for (const page of data.results) {
        const name = plainTitle(page.properties["Client"]);
        if (name) names.push(name);
      }
      hasMore = data.has_more;
      cursor = data.next_cursor;
      pages += 1;
    }

    return json({ configured: true, names });
  } catch (err) {
    return json({ configured: true, error: err.message, names: [] }, 200);
  }
};
