---
name: setup-domain-dns
description: Point a domain at Vercel/Stripe/webhooks (registrar-agnostic). Read playbooks/domain-dns.md for registrar (Cloudflare, Namecheap, Porkbun); distill DNS record types and propagation notes only.
---

# Domain & DNS setup (Orca setup skill)

## Before you start

1. Read **`playbooks/domain-dns.md`** — registrar, existing nameservers, and whether Cloudflare proxy is used.
2. Confirm **apex vs www** requirements and **SSL** expectations (Vercel/Cloudflare).

## Workflow

1. **Vercel / hosting:** From Vercel project settings, get required DNS records (A, CNAME, or ALIAS). For Stripe/custom domains, follow Stripe’s DNS verification strings.
2. **Apply at registrar:** Add records exactly as specified; if using Cloudflare, note proxy (orange cloud) vs DNS-only when SSL matters.
3. **Wait & verify:** Propagation can take minutes–48h; use `dig` or registrar UI to confirm.

## Distill

Record registrar-specific UI paths and record shapes (no account passwords) in `playbooks/domain-dns.md`.

## References

- Vercel domains: https://vercel.com/docs/concepts/projects/domains
- `docs/CENTRAL_BRAIN.md`
