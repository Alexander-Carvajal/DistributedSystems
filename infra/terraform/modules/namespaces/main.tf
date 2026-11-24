variable "names" {
  description = "Conjunto de namespaces para la plataforma."
  type        = set(string)
}

resource "kubernetes_namespace_v1" "this" {
  for_each = var.names

  metadata {
    name = each.value
    labels = {
      "app.kubernetes.io/part-of"    = "distributed-store"
      "app.kubernetes.io/managed-by" = "terraform"
    }
  }
}

output "names" {
  value = [for namespace in kubernetes_namespace_v1.this : namespace.metadata[0].name]
}
