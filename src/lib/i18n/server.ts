"use server";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, supportedLocales } from "./config";
import { usersCol } from "@/lib/mongodb";
import { auth } from "@/lib/auth";

/**
 * Set the user's locale preference (server action)
 * Updates both cookie and database (if logged in)
 */
export async function setLocaleServer(locale: string): Promise<void> {
  if (!supportedLocales.includes(locale)) {
    throw new Error(`Locale "${locale}" is not supported`);
  }
  
  // Set cookie
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "lax",
  });
  
  // Update database if user is logged in
  const session = await auth();
  if (session?.user?.id) {
    await usersCol().updateOne(
      { _id: session.user.id } as Record<string, unknown>,
      { $set: { locale } }
    );
  }
}

/**
 * Sync locale from database to cookie on login
 */
export async function syncLocaleFromUser(userId: string): Promise<void> {
  const user = await usersCol().findOne(
    { _id: userId } as Record<string, unknown>,
    { projection: { locale: 1 } }
  );

  if (user?.locale) {
    const cookieStore = await cookies();
    cookieStore.set(LOCALE_COOKIE, user.locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }
}
