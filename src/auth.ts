import type { NextAuthOptions } from "next-auth";
import Google from "next-auth/providers/google";
import Github from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import { getPasswordHash, upsertUser } from "@/lib/usage-tracker";

export const authOptions: NextAuthOptions = {
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email.toLowerCase().trim();
        const passwordHash = await getPasswordHash(email);

        if (!passwordHash) return null;

        const valid = await bcrypt.compare(credentials.password, passwordHash);
        if (!valid) return null;

        return {
          id: email,
          email,
          name: email.split("@")[0],
        };
      },
    }),
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
    Github({
      clientId: process.env.AUTH_GITHUB_ID!,
      clientSecret: process.env.AUTH_GITHUB_SECRET!,
    }),
  ],
  secret: process.env.AUTH_SECRET,
  pages: {
    signIn: "/",
  },
  callbacks: {
    async jwt({ token, account, user }) {
      if (account) {
        // OAuth sign-in — upsert user in Teable
        const email = user?.email || token.email;
        if (email) {
          const provider = account.provider as "google" | "github";
          await upsertUser(email, provider).catch(() => {});
        }
        token.id = account.providerAccountId;
      } else if (user) {
        // Credentials provider passes user at sign-in without an account
        token.id = user.id || (user.email as string);
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
      }
      return session;
    },
  },
};