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
        send({ type: "status", message: `Searching for ${count} podcast leads...` });

        const systemPrompt = `You are a podcast lead researcher. Your job is to find real podcast guest opportunities for coaches and experts.

You will receive a coach's full bio or niche description. First, analyze it to identify:
- Their core expertise and topics they can speak on
- Their target audience
- Related/adjacent topics that would be relevant
- The types of podcasts that would be a good fit

Then search the web extensively to find matching podcasts.

CRITICAL RULES:
1. Every lead MUST have a real contact email address (e.g. name@domain.com). NEVER include leads without emails.
2. Do NOT make up or guess email addresses. Only include emails you actually find on podcast websites, contact pages, or guest application forms via web search. Verify the email domain matches the podcast's actual website domain.
3. Search podcast websites, guest application pages, about pages, and contact pages to find emails.
4. Focus on podcasts that actively accept guest interviews.
5. Prioritize podcasts most relevant to the coach's expertise and audience.
6. Use web search extensively to find podcasts and their contact information.
7. Cast a wide net — search for podcasts in the coach's direct niche AND in adjacent/related topics.
8. Do NOT use placeholder or fake URLs. Every website and podcast_link must be a real URL you found via search. If you can't find the real URL, leave the field as an empty string.
9. Do NOT link to aggregator sites like feedspot.com, podchaser.com, etc. Link to the actual podcast website or Apple Podcasts/Spotify page.
10. Do NOT guess or fabricate Apple Podcast IDs. Only include podcast_link if you found the actual URL.
11. ONLY include podcasts that are currently ACTIVE — they must have published an episode within the last 6 months. Do NOT include paused, ended, or dormant podcasts.
12. Start by searching for the BIGGEST and most popular podcasts in the coach's exact niche first. These are the highest-value targets. Then expand to smaller and adjacent podcasts.
13. When verifying emails, search specifically for the podcast's contact page or guest submission page. The email domain must match the podcast's website domain. Do not guess email prefixes like "info@" or "hello@" without confirmation.

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
    "notes": "Brief description and why this podcast is a good fit for this specific coach"
  }
]
\`\`\`

Return ONLY the JSON array at the end, after all your research is complete.`;

        const userPrompt = `Here is a coach's bio/description. Find ${count} podcast guest opportunities that would be a great fit for them:

---
${niche}
---

Steps:
1. Analyze the bio to identify their core expertise, topics, audience, and angles
2. Search the web for podcasts in their direct niche
3. Search for podcasts in adjacent/related topics where they'd be a valuable guest
4. For each podcast found, search their website for a contact email
5. Only include podcasts where you can verify a real email address

Remember: EVERY lead must have a verified contact email. Skip any podcast where you cannot find an email.`;

        const messages: Anthropic.Messages.MessageParam[] = [
          { role: "user", content: userPrompt },
        ];

        let fullText = "";
        let turnCount = 0;
        const maxTurns = 20;

        while (turnCount < maxTurns) {
          turnCount++;
          send({ type: "status", message: `Researching podcasts... (turn ${turnCount})` });

          const response = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 16000,
            system: systemPrompt,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tools: [
              {
                type: "web_search_20250305",
                name: "web_search",
                max_uses: 40,
              } as any,
            ],
            messages,
          });

          // Collect text from this response
          for (const block of response.content) {
            if (block.type === "text") {
              fullText += block.text;
            }
          }

          // If Claude is done, break out
          if (response.stop_reason === "end_turn") {
            break;
          }

          // If Claude paused (needs to continue), clean up content and continue
          if ((response.stop_reason as string) === "pause_turn") {
            // Remove trailing server_tool_use blocks that don't have a matching result
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const content = [...response.content] as any[];
            const resultIds = new Set(
              content
                .filter((b) => b.type === "web_search_tool_result")
                .map((b) => b.tool_use_id)
            );
            const cleanedContent = content.filter((b) => {
              if (b.type === "server_tool_use") {
                return resultIds.has(b.id);
              }
              return true;
            });

            messages.push({ role: "assistant", content: cleanedContent });
            messages.push({ role: "user", content: "Continue your research and provide the final results." });
            continue;
          }

          // Any other stop reason, break
          break;
        }

        send({ type: "status", message: "Processing results..." });

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
          // Fallback: find any JSON array
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
