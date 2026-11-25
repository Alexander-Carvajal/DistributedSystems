# Seguridad local

Flux applies Pod Security Admission in `restricted` mode to `store-application` and `store-web` before reconciling their workloads. The API, worker, web, and catalog-init pods do not mount ServiceAccount tokens. Traefik rate-limits and requires Basic Auth for the public site and its same-origin API proxy.

The local CA and `store.localhost` certificate are issued by cert-manager. After the `store-web` namespace exists, create the login secret:

```powershell
.\scripts\setup-phase7-auth.ps1 -Username student
```

The script prompts for the password, hashes it with bcrypt using the local `httpd` container, and stores only the hash in Kubernetes. Open `https://store.localhost`. To trust the certificate in Windows, export only the CA certificate from the `store-local-root-ca` Secret in `cert-manager` and import that `.crt` into the current user's trusted root store. Do not export or distribute the CA private key.

Wazuh, K3s audit-log forwarding, SOPS encryption, cosign admission enforcement, and a kube-bench report are still outstanding. The Wazuh local Kubernetes profile calls for at least 4.5 GiB of free cluster memory, so check current cluster usage before enabling it alongside LGTM and the data services.
