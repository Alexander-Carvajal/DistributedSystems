locals {
  kubeconfig_path = var.kubeconfig_path == null ? abspath("${path.root}/../../../../.tools/kubeconfig") : var.kubeconfig_path
}

provider "kubernetes" {
  config_path = local.kubeconfig_path
}

module "namespaces" {
  source = "../../modules/namespaces"

  names = toset([
    "store-web",
    "store-application",
    "store-data",
    "platform-observability",
    "platform-security",
  ])
}
