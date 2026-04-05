import { NextRequest, NextResponse } from "next/server";

interface GenerateReplyRequest {
  subject?: string;
  from?: string;
  body?: string;
}

/**
 * POST /api/generate-reply
 *
 * Stub endpoint that simulates an LLM generating a contextual email reply.
 * In production, replace the mock logic below with a call to your preferred
 * LLM provider (e.g. OpenAI chat completions, Anthropic, or a custom Quant model).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let payload: GenerateReplyRequest;

  try {
    payload = (await request.json()) as GenerateReplyRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { subject = "", from = "", body = "" } = payload;

  if (!body.trim()) {
    return NextResponse.json(
      { error: "Email body is required to generate a reply" },
      { status: 422 }
    );
  }

  // ---------------------------------------------------------------------------
  // TODO: Replace this mock with a real LLM call, e.g.:
  //
  // const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  // const completion = await openai.chat.completions.create({
  //   model: "gpt-4o",
  //   messages: [
  //     { role: "system", content: "You are a helpful email assistant. Generate a concise, professional reply." },
  //     { role: "user", content: `Subject: ${subject}\nFrom: ${from}\n\n${body}` },
  //   ],
  // });
  // const reply = completion.choices[0]?.message.content ?? "";
  // ---------------------------------------------------------------------------

  // Simulate a small network/processing delay
  await new Promise((resolve) => setTimeout(resolve, 900));

  const reply = generateMockReply({ subject, from, body });

  return NextResponse.json({ reply });
}

function generateMockReply({
  subject,
  from,
  body,
}: GenerateReplyRequest): string {
  const lowerBody = (body ?? "").toLowerCase();
  const lowerSubject = (subject ?? "").toLowerCase();

  // Contextual mock responses based on keywords
  if (lowerSubject.includes("roadmap") || lowerBody.includes("roadmap")) {
    return `Hi ${from?.split(" ")[0] ?? "there"},

Thanks for sharing the roadmap — the AI Feature Suite and Performance Sprint priorities look well-aligned with what the team has been discussing.

I'll review the full deck and have my written feedback ready by Friday. If anything comes up before then I'll flag it directly in the doc.

Best,
Kundan`;
  }

  if (lowerBody.includes("mockup") || lowerBody.includes("design") || lowerBody.includes("figma")) {
    return `Hi ${from?.split(" ")[0] ?? "there"},

These look great — the new indigo gradient is a huge improvement and the mobile breakpoints are exactly right.

A Figma walk-through would be really helpful before dev handoff. Can we schedule 30 minutes this week?

Thanks,
Kundan`;
  }

  if (lowerBody.includes("investor") || lowerBody.includes("arr") || lowerBody.includes("metrics")) {
    return `Hi ${from?.split(" ")[0] ?? "there"},

Really glad to hear the metrics are tracking well. I'll get the updated cap table and ARR projections over to you by end of day tomorrow.

Looking forward to the call on the 18th.

Best,
Kundan`;
  }

  if (lowerBody.includes("feedback") || lowerBody.includes("keyboard shortcut")) {
    return `Hi ${from?.split(" ")[0] ?? "there"},

Thank you so much for this — it means a lot to hear the smart reply is genuinely saving you time.

The Cmd+Shift+R keyboard shortcut is a great idea and I've added it to our next sprint. Keep the feedback coming!

Best,
Kundan`;
  }

  // Default fallback
  return `Hi ${from?.split(" ")[0] ?? "there"},

Thanks for your email. Sounds great — I'll take a look and get back to you shortly.

Best,
Kundan`;
}
