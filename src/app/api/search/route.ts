import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export const maxDuration = 300;

export async function POST(request: Request) {
  const { niche, count = 25 } = await request.json();

  if (!niche || typeof niche !== "string") {
    return Response.json({ error: "Niche is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        send({ type: "status", message: `Searching for ${count} podcast leads in "${niche}"...` });

        const systemPrompt = `You are a podcast lead researcher. Your job is to find real podcast guest opportunities for coaches and experts.

CRITICAL RULES:
1. Every lead MUST have a real contact email address (e.g. name@domain.com). NEVER include leads without emails.
2. Do NOT make up or guess email addresses. Only include emails you find from web search results.
3. Search podcast websites, guest application pages, about pages, and contact pages to find emails.
4. Focus on podcasts that actively accept guest interviews.
5. Prioritize podcasts relevant to the given niche.
6. Use web search extensively to find podcasts and their contact information.

After researching, return your final results as a JSON array inside a \`\`\`json code block with this exact structure:
\`\`\`json
[
  {
    "podcast_name": "Example Podcast",
    "host": "Host Name",
    "contact_email": "host@example.com",
    "website": "https://example.com",
    "podcast_link": "https://podcasts.apple.com/...",
    "category": "Category",
    "notes": "Brief description and relevance"
  }
]
\`\`\`

Return ONLY the JSON array at the end, after all your research is complete.`;

        const userPrompt = `Find ${count} podcast guest opportunities for a coach/expert in this niche: "${niche}"

Search the web thoroughly for podcasts in this niche and related topics. For each podcast, find their contact email from their website or guest application page. Only include podcasts where you can verify a real email address.

Search for:
1. Podcasts directly in the "${niche}" space
2. Adjacent/related topic podcasts that would welcome a "${niche}" expert
3. Business/leadership/entrepreneurship podcasts relevant to this niche
4. Interview-format podcasts that actively seek guests

Remember: EVERY lead must have a verified contact email. Skip any podcast where you cannot find an email.`;

        // Web search is a server-side tool — the API executes it automatically
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 16000,
          system: systemPrompt,
          tools: [
            {
              type: "web_search_20250305",
              name: "web_search",
              max_uses: 40,
            },
          ],
          messages: [{ role: "user", content: userPrompt }],
        });

        send({ type: "status", message: "Processing results..." });

        // Collect all text from the response
        let fullText = "";
        for (const block of response.content) {
          if (block.type === "text") {
            fullText += block.text;
          }
        }

        // Extract JSON from the response text
        const jsonMatch = fullText.match(/```json\s*([\s\S]*?)```/);
        let parsed = false;

        if (jsonMatch) {
          try {
            const leads = JSON.parse(jsonMatch[1].trim());
            if (Array.isArray(leads)) {
              const validLeads = leads.filter(
                (l: Record<string, string>) =>
                  l.contact_email &&
                  l.contact_email.includes("@") &&
                  !l.contact_email.includes("example.com")
              );
              send({ type: "leads", leads: validLeads });
              parsed = true;
            }
          } catch {
            // try fallback
          }
        }

        if (!parsed) {
          // Fallback: find any JSON array in the text
          const arrayMatch = fullText.match(/\[\s*\{[\s\S]*?\}\s*\]/);
          if (arrayMatch) {
            try {
              const leads = JSON.parse(arrayMatch[0]);
              const validLeads = leads.filter(
                (l: Record<string, string>) =>
                  l.contact_email &&
                  l.contact_email.includes("@") &&
                  !l.contact_email.includes("example.com")
              );
              send({ type: "leads", leads: validLeads });
              parsed = true;
            } catch {
              // fall through
            }
          }
        }

        if (!parsed) {
          send({
            type: "error",
            message: "Could not parse results. Please try again.",
          });
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        send({ type: "error", message });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
