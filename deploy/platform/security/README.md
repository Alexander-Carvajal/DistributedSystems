# Seguridad local

Flux applies Pod Security Admission in `restricted` mode to `store-application` and `store-web` before reconciling their workloads. The API, worker, web, and catalog-init pods do not mount ServiceAccount tokens. Traefik rate-limits and requires Basic Auth for the public site and its same-origin API proxy. CI scans application images with Trivy; release images are signed with Cosign.

The local CA and `store.localhost` certificate are issued by cert-manager. After the `store-web` namespace exists, create the login secret:

```powershell
.\scripts\setup-phase7-auth.ps1 -Username student
```

The script prompts for the password, hashes it with bcrypt using the local `httpd` container, and stores only the hash in Kubernetes. Run it once the `store-web` namespace exists. Open `https://store.localhost`. To trust the certificate in Windows, export only the CA certificate from the `store-local-root-ca` Secret in `cert-manager` and import that `.crt` into the current user's trusted root store. Do not export or distribute the CA private key.

## Secret encryption with SOPS and age

The development database, API, and queue credentials are encrypted with SOPS using the age recipient below. Flux decrypts them in-cluster before applying them. The private age key is stored locally at `.tools/sops/age/keys.txt` (ignored by Git) and in `flux-system/sops-age`; never commit or share that private key. Keep a protected backup because losing it makes these encrypted manifests unrecoverable.

```text
age14gjudzk2v9pga3ymyfl0aryvjzkmr2y6l096f3rgk3n8jdlss59q4srw8n
```

After recreating the cluster, install Flux and its `flux-system` namespace, then reinstall the key before relying on the encrypted resources:

```powershell
./scripts/setup-sops-age.ps1 -Kubeconfig "$env:USERPROFILE/.config/k3d/kubeconfig-distributed-lab.yaml"
```

The tracked SOPS files are under `deploy/overlays/dev/data/secrets/`, `deploy/overlays/dev/app-secrets/`, and `deploy/overlays/dev/catalog-init/`. To rotate a Kubernetes Secret, update it through the appropriate setup script, then use `scripts/encrypt-k8s-secret.ps1` to replace its tracked encrypted manifest. The script verifies decryption locally before writing ciphertext. CI skips Kubernetes Secret objects because their tracked `data` values and SOPS metadata are ciphertext; Flux decrypts them before API schema validation and apply.

Still outstanding in Phase 7: Wazuh, K3s audit-log forwarding, cosign admission enforcement, and a kube-bench report. The Wazuh local Kubernetes profile calls for at least 4.5 GiB of free cluster memory, so check current cluster usage before enabling it alongside LGTM and the data services. Basic Auth also remains a one-time local setup because its password must be chosen privately by the operator.
