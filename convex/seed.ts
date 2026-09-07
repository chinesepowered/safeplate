import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { newCaseCode } from "./lib/mailUtil";
import { CASE_PREFIX } from "./lib/app";
import type { Id } from "./_generated/dataModel";

/**
 * Demo data. The app must look alive the second a judge opens it, without
 * waiting on a live crawl and without spending Firecrawl credits, so `run`
 * builds one template profile and every visitor gets their own working copy of
 * it (seed.copyDemo below). The template is a real-shaped snapshot: menu
 * text as it was scraped, verdicts with the evidence that produced them, and a
 * restaurant that has already answered its email.
 */

export const DEMO_SLUG = "safeplate-demo-template";

type SeedDish = {
  name: string;
  description?: string;
  price?: string;
  section?: string;
  ingredients?: string[];
  verdict: "safe" | "risky" | "unsafe" | "unclear";
  reason: string;
  evidence: "menu" | "reply";
};

type SeedQuestion = { text: string; answer?: string; quote?: string };

type SeedMessage = {
  direction: "in" | "out";
  subject: string;
  text: string;
  from?: string;
  to?: string;
  classification?: string;
  summary?: string;
  minutesAgo: number;
};

type SeedRestaurant = {
  name: string;
  website: string;
  menuUrl: string;
  contactEmail?: string;
  address: string;
  lat: number;
  lng: number;
  status:
    | "scraping"
    | "reviewed"
    | "asked"
    | "confirmed"
    | "avoid"
    | "unclear"
    | "failed"
    | "paused";
  verdict?: "safe" | "risky" | "unsafe" | "unclear";
  verdictReason?: string;
  statusDetail?: string;
  menuExcerpt: string;
  menuChanged?: boolean;
  askedHoursAgo?: number;
  repliedHoursAgo?: number;
  dishes: SeedDish[];
  questions: SeedQuestion[];
  messages: SeedMessage[];
};

const MODEL = "seeded-demo";

const RESTAURANTS: SeedRestaurant[] = [
  {
    name: "Bangkok Garden",
    website: "https://example-bangkokgarden.ca",
    menuUrl: "https://example-bangkokgarden.ca/menu",
    contactEmail: "hello@example-bangkokgarden.ca",
    address: "12 King Street North, Waterloo, ON",
    lat: 43.4668,
    lng: -80.5223,
    status: "confirmed",
    verdict: "safe",
    verdictReason:
      "The kitchen confirmed a dedicated nut-free wok station and named the dishes that contain peanut.",
    statusDetail: "Confirmed by the restaurant — 3 dishes they say are safe.",
    askedHoursAgo: 30,
    repliedHoursAgo: 26,
    menuExcerpt:
      "# Bangkok Garden — Menu\n\n## Starters\n\n**Fresh Spring Rolls** — rice paper, vermicelli, mint, carrot, served with hoisin dip. $8\n\n**Chicken Satay** — grilled skewers with our house peanut sauce. $11\n\n**Tom Yum Soup** — lemongrass, galangal, lime leaf, mushroom, chilli. $9\n\n## Mains\n\n**Pad Thai** — rice noodles, egg, tamarind, bean sprouts, crushed peanuts. $17\n\n**Green Curry** — coconut milk, Thai basil, bamboo shoot, choice of chicken or tofu. $18\n\n**Pad See Ew** — wide rice noodles, Chinese broccoli, dark soy, egg. $17\n\n**Massaman Curry** — potato, onion, roasted peanut, coconut. $19",
    dishes: [
      {
        name: "Fresh Spring Rolls",
        description: "Rice paper, vermicelli, mint, carrot, served with hoisin dip.",
        price: "$8",
        section: "Starters",
        ingredients: ["rice paper", "vermicelli", "mint", "carrot", "hoisin"],
        verdict: "safe",
        reason:
          'The kitchen wrote "the spring rolls, tom yum and pad see ew are made at the nut-free station and the hoisin we use has no nuts".',
        evidence: "reply",
      },
      {
        name: "Chicken Satay",
        description: "Grilled skewers with our house peanut sauce.",
        price: "$11",
        section: "Starters",
        ingredients: ["chicken", "peanut sauce"],
        verdict: "unsafe",
        reason: 'The menu names "house peanut sauce" in the dish itself.',
        evidence: "menu",
      },
      {
        name: "Tom Yum Soup",
        description: "Lemongrass, galangal, lime leaf, mushroom, chilli.",
        price: "$9",
        section: "Starters",
        verdict: "safe",
        reason:
          'Confirmed in the reply: "the spring rolls, tom yum and pad see ew are made at the nut-free station".',
        evidence: "reply",
      },
      {
        name: "Pad Thai",
        description: "Rice noodles, egg, tamarind, bean sprouts, crushed peanuts.",
        price: "$17",
        section: "Mains",
        ingredients: ["rice noodles", "egg", "tamarind", "peanuts"],
        verdict: "unsafe",
        reason: 'The menu lists "crushed peanuts" in the dish.',
        evidence: "menu",
      },
      {
        name: "Green Curry",
        description: "Coconut milk, Thai basil, bamboo shoot, choice of chicken or tofu.",
        price: "$18",
        section: "Mains",
        verdict: "risky",
        reason:
          'The reply says "the curry pastes are bought in and the supplier labels them may contain peanut".',
        evidence: "reply",
      },
      {
        name: "Pad See Ew",
        description: "Wide rice noodles, Chinese broccoli, dark soy, egg.",
        price: "$17",
        section: "Mains",
        verdict: "safe",
        reason:
          'Confirmed in the reply: "pad see ew are made at the nut-free station" with no peanut in the dish.',
        evidence: "reply",
      },
      {
        name: "Massaman Curry",
        description: "Potato, onion, roasted peanut, coconut.",
        price: "$19",
        section: "Mains",
        ingredients: ["potato", "onion", "roasted peanut", "coconut"],
        verdict: "unsafe",
        reason: 'The menu lists "roasted peanut" as an ingredient.',
        evidence: "menu",
      },
    ],
    questions: [
      {
        text: "Do you have a dedicated nut-free wok or fryer, separate from dishes with peanut sauce?",
        answer:
          "Yes — there is a dedicated nut-free station used for the spring rolls, tom yum and pad see ew.",
        quote:
          "We keep one wok station nut-free all service; the spring rolls, tom yum and pad see ew are made at the nut-free station.",
      },
      {
        text: "Which dishes on the menu contain peanuts or tree nuts, including sauces and garnishes?",
        answer: "The satay, pad thai and massaman curry all contain peanut.",
        quote: "The satay, the pad thai and the massaman all have peanut in them, no exceptions.",
      },
      {
        text: 'Do any of your bought-in sauces or pastes carry a "may contain nuts" label?',
        answer: "Yes — the curry pastes are labelled may contain peanut.",
        quote: "The curry pastes are bought in and the supplier labels them may contain peanut.",
      },
      {
        text: "Can the kitchen prepare a meal for a child with an anaphylactic peanut allergy if we tell you when we book?",
        answer: "Yes, if you tell them when booking they will flag it to the kitchen.",
        quote: "Tell us when you book and we will flag it to the kitchen for that service.",
      },
    ],
    messages: [
      {
        direction: "out",
        subject: "Allergy question from a customer (peanut, tree nut)",
        to: "hello@example-bangkokgarden.ca",
        minutesAgo: 30 * 60,
        text:
          "Hello,\n\nI'd love to bring my family to Bangkok Garden. My daughter Maya has an anaphylactic allergy to peanuts and tree nuts, and your menu doesn't quite tell me what I need to know, so I hope you don't mind four quick questions:\n\n1. Do you have a dedicated nut-free wok or fryer, separate from dishes with peanut sauce?\n2. Which dishes on the menu contain peanuts or tree nuts, including sauces and garnishes?\n3. Do any of your bought-in sauces or pastes carry a \"may contain nuts\" label?\n4. Can the kitchen prepare a meal for a child with an anaphylactic peanut allergy if we tell you when we book?\n\nA sentence or two on each is plenty — thank you so much.\n\nA SafePlate user",
      },
      {
        direction: "in",
        subject: "Re: Allergy question from a customer (peanut, tree nut)",
        from: "hello@example-bangkokgarden.ca",
        minutesAgo: 26 * 60,
        classification: "answered",
        summary:
          "Dedicated nut-free station confirmed; satay, pad thai and massaman contain peanut; curry pastes are may-contain.",
        text:
          "Hi, thanks for asking before coming.\n\nWe keep one wok station nut-free all service; the spring rolls, tom yum and pad see ew are made at the nut-free station and the hoisin we use has no nuts. The satay, the pad thai and the massaman all have peanut in them, no exceptions. The curry pastes are bought in and the supplier labels them may contain peanut, so I would not serve those to a child with a severe allergy. Tell us when you book and we will flag it to the kitchen for that service.\n\nBest,\nNok",
      },
    ],
  },
  {
    name: "Sweet Crumb Bakery",
    website: "https://example-sweetcrumb.ca",
    menuUrl: "https://example-sweetcrumb.ca/menu",
    contactEmail: "orders@example-sweetcrumb.ca",
    address: "88 Regina Street South, Waterloo, ON",
    lat: 43.4622,
    lng: -80.5289,
    status: "avoid",
    verdict: "unsafe",
    verdictReason:
      "The bakery says everything is made on shared surfaces with almond flour and they cannot guarantee any item.",
    statusDetail: "The restaurant says they cannot handle this allergy safely.",
    askedHoursAgo: 50,
    repliedHoursAgo: 47,
    menuExcerpt:
      "# Sweet Crumb — Today's Counter\n\n**Almond Croissant** — house frangipane, toasted flaked almonds. $6\n\n**Butter Croissant** — 72-hour laminated, French butter. $5\n\n**Chocolate Chip Cookie** — brown butter, sea salt. $4\n\n**Lemon Tart** — pâte sablée, lemon curd, torched meringue. $7",
    dishes: [
      {
        name: "Almond Croissant",
        description: "House frangipane, toasted flaked almonds.",
        price: "$6",
        section: "Counter",
        ingredients: ["almond", "frangipane"],
        verdict: "unsafe",
        reason: 'The menu names "toasted flaked almonds" in the dish.',
        evidence: "menu",
      },
      {
        name: "Butter Croissant",
        description: "72-hour laminated, French butter.",
        price: "$5",
        section: "Counter",
        verdict: "unsafe",
        reason:
          'The bakery replied "everything is rolled on the same bench as our almond frangipane".',
        evidence: "reply",
      },
      {
        name: "Chocolate Chip Cookie",
        description: "Brown butter, sea salt.",
        price: "$4",
        section: "Counter",
        verdict: "unsafe",
        reason:
          'The bakery replied "we cannot call anything here nut-free" — shared surfaces throughout.',
        evidence: "reply",
      },
      {
        name: "Lemon Tart",
        description: "Pâte sablée, lemon curd, torched meringue.",
        price: "$7",
        section: "Counter",
        verdict: "unsafe",
        reason:
          'The bakery replied that ground almond goes into the tart shells: "our sablée has ground almond in it".',
        evidence: "reply",
      },
    ],
    questions: [
      {
        text: "Are any items baked or finished away from almond flour and nut products?",
        answer: "No — everything shares a bench with almond frangipane.",
        quote:
          "Everything is rolled on the same bench as our almond frangipane, so we cannot call anything here nut-free.",
      },
      {
        text: "Does the pastry for the lemon tart contain nuts?",
        answer: "Yes, the sablée contains ground almond.",
        quote: "Our sablée has ground almond in it.",
      },
    ],
    messages: [
      {
        direction: "out",
        subject: "Allergy question from a customer (peanut, tree nut)",
        to: "orders@example-sweetcrumb.ca",
        minutesAgo: 50 * 60,
        text:
          "Hello,\n\nMy daughter Maya has an anaphylactic peanut and tree nut allergy and I'd love to be able to bring her in. Two quick questions:\n\n1. Are any items baked or finished away from almond flour and nut products?\n2. Does the pastry for the lemon tart contain nuts?\n\nThank you!\n\nA SafePlate user",
      },
      {
        direction: "in",
        subject: "Re: Allergy question from a customer (peanut, tree nut)",
        from: "orders@example-sweetcrumb.ca",
        minutesAgo: 47 * 60,
        classification: "declined",
        summary: "Shared surfaces throughout; the bakery will not vouch for any item.",
        text:
          "Hello,\n\nI'm sorry — we are a small kitchen. Everything is rolled on the same bench as our almond frangipane, so we cannot call anything here nut-free. Our sablée has ground almond in it too. I would rather tell you honestly than risk it.\n\nMarta",
      },
    ],
  },
  {
    name: "Union Burger",
    website: "https://example-unionburger.ca",
    menuUrl: "https://example-unionburger.ca/menu",
    contactEmail: "info@example-unionburger.ca",
    address: "5 Erb Street West, Waterloo, ON",
    lat: 43.4655,
    lng: -80.5245,
    status: "reviewed",
    verdict: "unclear",
    verdictReason:
      "Nothing on the menu names a nut, but the menu says nothing about the fryer or the buns — that is what the email asks.",
    statusDetail: "Reviewed against the menu. Questions ready to send.",
    menuExcerpt:
      "# Union Burger\n\n**The Union** — 6oz chuck patty, aged cheddar, house sauce, brioche bun. $16\n\n**Mushroom Swiss** — roasted cremini, swiss, garlic aioli. $17\n\n**Crispy Chicken** — buttermilk-brined, pickles, slaw. $16\n\n**Fries** — cooked in our fryer, sea salt. $6\n\n**Salted Caramel Shake** — soft serve, caramel, whipped cream. $8",
    dishes: [
      {
        name: "The Union",
        description: "6oz chuck patty, aged cheddar, house sauce, brioche bun.",
        price: "$16",
        section: "Burgers",
        verdict: "unclear",
        reason:
          'The menu does not say what is in the "house sauce" or whether the brioche bun is baked near nuts.',
        evidence: "menu",
      },
      {
        name: "Mushroom Swiss",
        description: "Roasted cremini, swiss, garlic aioli.",
        price: "$17",
        section: "Burgers",
        verdict: "unclear",
        reason: "No nut is named, but the menu says nothing about how the aioli is made.",
        evidence: "menu",
      },
      {
        name: "Crispy Chicken",
        description: "Buttermilk-brined, pickles, slaw.",
        price: "$16",
        section: "Burgers",
        verdict: "risky",
        reason:
          'Fried items usually share oil, and the menu says only "cooked in our fryer" with no separation mentioned.',
        evidence: "menu",
      },
      {
        name: "Fries",
        description: "Cooked in our fryer, sea salt.",
        price: "$6",
        section: "Sides",
        verdict: "risky",
        reason: 'The menu says "our fryer" — a single shared fryer is the usual arrangement.',
        evidence: "menu",
      },
      {
        name: "Salted Caramel Shake",
        description: "Soft serve, caramel, whipped cream.",
        price: "$8",
        section: "Drinks",
        verdict: "unclear",
        reason:
          "Ice cream lines commonly run nut flavours on the same equipment; the menu does not say.",
        evidence: "menu",
      },
    ],
    questions: [
      { text: "Is the fryer used for the fries shared with any breaded or nut-containing items?" },
      { text: 'What is in the "house sauce" on The Union — does it contain any nut oil or nut paste?' },
      { text: "Are your brioche buns baked in a facility that also handles peanuts or tree nuts?" },
      { text: "Does your soft serve or caramel come from a line that also runs nut flavours?" },
    ],
    messages: [],
  },
  {
    name: "Forno Pizzeria",
    website: "https://example-forno.ca",
    menuUrl: "https://example-forno.ca/menu",
    contactEmail: "ciao@example-forno.ca",
    address: "300 King Street West, Kitchener, ON",
    lat: 43.4501,
    lng: -80.4934,
    status: "asked",
    verdict: "unclear",
    verdictReason: "Waiting on the kitchen — the pesto and the dessert are the open questions.",
    statusDetail: "Sent. Waiting for the restaurant to reply.",
    askedHoursAgo: 3,
    menuChanged: true,
    menuExcerpt:
      "# Forno Pizzeria\n\n**Margherita** — San Marzano, fior di latte, basil. $18\n\n**Diavola** — spicy salami, chilli honey. $21\n\n**Pesto Verde** — basil pesto, ricotta, lemon zest. $22\n\n**Tiramisu** — mascarpone, espresso, savoiardi. $10",
    dishes: [
      {
        name: "Margherita",
        description: "San Marzano, fior di latte, basil.",
        price: "$18",
        section: "Pizza",
        verdict: "unclear",
        reason:
          "No nut is named, but the menu does not say whether pesto is made on the same surface.",
        evidence: "menu",
      },
      {
        name: "Diavola",
        description: "Spicy salami, chilli honey.",
        price: "$21",
        section: "Pizza",
        verdict: "unclear",
        reason: "Nothing on this line names a nut, and preparation is not described.",
        evidence: "menu",
      },
      {
        name: "Pesto Verde",
        description: "Basil pesto, ricotta, lemon zest.",
        price: "$22",
        section: "Pizza",
        verdict: "risky",
        reason: 'Basil pesto is normally made with pine nuts and the menu just says "basil pesto".',
        evidence: "menu",
      },
      {
        name: "Tiramisu",
        description: "Mascarpone, espresso, savoiardi.",
        price: "$10",
        section: "Dolci",
        verdict: "unclear",
        reason: "Savoiardi are often produced in bakeries that also handle nuts; the menu is silent.",
        evidence: "menu",
      },
    ],
    questions: [
      { text: "Does your basil pesto contain pine nuts, cashews or any other nut?" },
      { text: "Is the pesto prepared on the same surface as the other pizzas?" },
      { text: "Do the savoiardi in the tiramisu carry a may-contain-nuts label?" },
    ],
    messages: [
      {
        direction: "out",
        subject: "Allergy question from a customer (peanut, tree nut)",
        to: "ciao@example-forno.ca",
        minutesAgo: 3 * 60,
        text:
          "Hello,\n\nWe'd love to eat with you. My daughter Maya has an anaphylactic peanut and tree nut allergy, so three quick questions before we book:\n\n1. Does your basil pesto contain pine nuts, cashews or any other nut?\n2. Is the pesto prepared on the same surface as the other pizzas?\n3. Do the savoiardi in the tiramisu carry a may-contain-nuts label?\n\nA short reply is plenty — thank you!\n\nA SafePlate user",
      },
    ],
  },
];

async function findOrCreateDemoUser(ctx: any): Promise<Id<"users">> {
  const existing = await ctx.db
    .query("users")
    .filter((q: any) => q.eq(q.field("name"), "SafePlate demo"))
    .first();
  if (existing) return existing._id;
  return await ctx.db.insert("users", { name: "SafePlate demo" });
}

/**
 * Build (or rebuild) the template profile. Safe to re-run: the old template and
 * everything hanging off it is deleted first.
 */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const ownerId = await findOrCreateDemoUser(ctx);

    const old = await ctx.db
      .query("profiles")
      .withIndex("by_slug", (q) => q.eq("slug", DEMO_SLUG))
      .unique();
    if (old) await deleteProfileTree(ctx, old._id);

    const profileId = await ctx.db.insert("profiles", {
      ownerId,
      slug: DEMO_SLUG,
      personName: "Maya",
      allergens: ["peanut", "tree nut"],
      severity: "anaphylaxis",
      notes: "Carries an EpiPen. Reacts to trace amounts, including shared fryer oil.",
      city: "Waterloo, ON",
      caseCode: newCaseCode(CASE_PREFIX),
      createdAt: Date.now(),
    });

    const now = Date.now();
    let created = 0;
    for (const r of RESTAURANTS) {
      const restaurantId = await ctx.db.insert("restaurants", {
        profileId,
        ownerId,
        name: r.name,
        website: r.website,
        menuUrl: r.menuUrl,
        sourceUrl: r.menuUrl,
        contactEmail: r.contactEmail,
        address: r.address,
        lat: r.lat,
        lng: r.lng,
        menuExcerpt: r.menuExcerpt,
        status: r.status,
        verdict: r.verdict,
        verdictReason: r.verdictReason,
        statusDetail: r.statusDetail,
        menuChanged: r.menuChanged,
        menuHash: `seed-${r.name.toLowerCase().replace(/\s+/g, "-")}`,
        lastScrapedAt: now - 4 * 24 * 60 * 60 * 1000,
        caseCode: newCaseCode(CASE_PREFIX),
        askedAt: r.askedHoursAgo ? now - r.askedHoursAgo * 3600_000 : undefined,
        repliedAt: r.repliedHoursAgo ? now - r.repliedHoursAgo * 3600_000 : undefined,
        model: MODEL,
        createdAt: now - created * 1000,
      });
      created++;

      for (const d of r.dishes) {
        await ctx.db.insert("dishes", {
          restaurantId,
          profileId,
          name: d.name,
          description: d.description,
          price: d.price,
          section: d.section,
          ingredients: d.ingredients,
          verdict: d.verdict,
          reason: d.reason,
          evidence: d.evidence,
          updatedFromReply: d.evidence === "reply",
          model: MODEL,
          updatedAt: now,
        });
      }

      let order = 0;
      for (const q of r.questions) {
        await ctx.db.insert("questions", {
          restaurantId,
          profileId,
          text: q.text,
          answer: q.answer,
          quote: q.quote,
          answeredBy: q.answer ? "reply" : undefined,
          answeredAt: q.answer ? now - 26 * 3600_000 : undefined,
          order: order++,
        });
      }

      for (const m of r.messages) {
        await ctx.db.insert("mailMessages", {
          direction: m.direction,
          messageId: `seed-${restaurantId}-${m.direction}-${m.minutesAgo}`,
          from: m.from,
          to: m.to ? [m.to] : undefined,
          subject: m.subject,
          extractedText: m.text,
          fullText: m.text,
          targetId: restaurantId,
          routed: true,
          classification: m.classification,
          summary: m.summary,
          deliveryStatus: m.direction === "out" ? "delivered" : undefined,
          at: now - m.minutesAgo * 60_000,
        });
      }
    }

    return { profileId, restaurants: RESTAURANTS.length };
  },
});

async function deleteProfileTree(ctx: any, profileId: Id<"profiles">) {
  const restaurants = await ctx.db
    .query("restaurants")
    .withIndex("by_profile", (q: any) => q.eq("profileId", profileId))
    .collect();
  for (const r of restaurants) {
    for (const d of await ctx.db
      .query("dishes")
      .withIndex("by_restaurant", (q: any) => q.eq("restaurantId", r._id))
      .collect()) {
      await ctx.db.delete(d._id);
    }
    for (const q of await ctx.db
      .query("questions")
      .withIndex("by_restaurant", (q2: any) => q2.eq("restaurantId", r._id))
      .collect()) {
      await ctx.db.delete(q._id);
    }
    for (const m of await ctx.db
      .query("mailMessages")
      .withIndex("by_target", (q: any) => q.eq("targetId", r._id as string))
      .collect()) {
      await ctx.db.delete(m._id);
    }
    await ctx.db.delete(r._id);
  }
  await ctx.db.delete(profileId);
}

/** Is there demo data to copy? Drives the "Load the demo family" button. */
export const available = query({
  args: {},
  handler: async (ctx) => {
    const t = await ctx.db
      .query("profiles")
      .withIndex("by_slug", (q) => q.eq("slug", DEMO_SLUG))
      .unique();
    return Boolean(t);
  },
});

/**
 * Give this visitor their own copy of the demo family, so the app is alive and
 * fully interactive on first load without a crawl. Their copy is theirs: new
 * ids, a new public slug and new email codes, so replies route to their rows.
 */
export const copyDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");

    const mine = await ctx.db
      .query("profiles")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    if (mine.length) return mine[0]._id;

    const template = await ctx.db
      .query("profiles")
      .withIndex("by_slug", (q) => q.eq("slug", DEMO_SLUG))
      .unique();
    if (!template) throw new Error("No demo data on this deployment yet.");

    const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
    let suffix = "";
    for (let i = 0; i < 10; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];

    const profileId = await ctx.db.insert("profiles", {
      ownerId: userId,
      slug: `maya-${suffix}`,
      personName: template.personName,
      allergens: template.allergens,
      severity: template.severity,
      notes: template.notes,
      city: template.city,
      caseCode: newCaseCode(CASE_PREFIX),
      createdAt: Date.now(),
    });

    const restaurants = await ctx.db
      .query("restaurants")
      .withIndex("by_profile", (q) => q.eq("profileId", template._id))
      .collect();

    for (const r of restaurants) {
      // Skip anything still mid-pipeline in the template: a half-scraped copy
      // would sit on a spinner forever, because a copy never re-runs the crawl.
      if (r.status === "scraping" || r.status === "failed" || r.status === "paused") continue;
      const { _id, _creationTime, ...rest } = r;
      const newId = await ctx.db.insert("restaurants", {
        ...rest,
        profileId,
        ownerId: userId,
        caseCode: newCaseCode(CASE_PREFIX),
      });
      for (const d of await ctx.db
        .query("dishes")
        .withIndex("by_restaurant", (q) => q.eq("restaurantId", _id))
        .collect()) {
        const { _id: _d, _creationTime: _dc, ...dr } = d;
        await ctx.db.insert("dishes", { ...dr, restaurantId: newId, profileId });
      }
      for (const q of await ctx.db
        .query("questions")
        .withIndex("by_restaurant", (q2) => q2.eq("restaurantId", _id))
        .collect()) {
        const { _id: _q, _creationTime: _qc, ...qr } = q;
        await ctx.db.insert("questions", { ...qr, restaurantId: newId, profileId });
      }
      for (const m of await ctx.db
        .query("mailMessages")
        .withIndex("by_target", (q) => q.eq("targetId", _id as string))
        .collect()) {
        const { _id: _m, _creationTime: _mc, ...mr } = m;
        await ctx.db.insert("mailMessages", {
          ...mr,
          messageId: `${mr.messageId}-${suffix}`,
          targetId: newId,
        });
      }
    }

    return profileId;
  },
});

/**
 * Add a real restaurant to the demo template and run the live pipeline on it
 * (Firecrawl → LLM). Used to top the demo data up with a genuinely scraped menu
 * before a deploy, so what judges see on first load is real, not written by us.
 *
 *   pnpm exec convex run seed:addToTemplate '{"input":"https://…/menu"}'
 */
export const addToTemplate = internalMutation({
  args: { input: v.string() },
  handler: async (ctx, { input }) => {
    const template = await ctx.db
      .query("profiles")
      .withIndex("by_slug", (q) => q.eq("slug", DEMO_SLUG))
      .unique();
    if (!template) throw new Error("Run seed:run first.");

    const isUrl = /^https?:\/\//i.test(input.trim());
    const id = await ctx.db.insert("restaurants", {
      profileId: template._id,
      ownerId: template.ownerId,
      name: isUrl ? new URL(input).hostname.replace(/^www\./, "") : input,
      website: isUrl ? input : undefined,
      status: "scraping",
      statusDetail: "Reading the site…",
      caseCode: newCaseCode(CASE_PREFIX),
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.menu.discover, {
      restaurantId: id,
      url: isUrl ? input : undefined,
      query: isUrl ? undefined : input,
    });
    return id;
  },
});
