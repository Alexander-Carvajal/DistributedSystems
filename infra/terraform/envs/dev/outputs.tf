output "namespace_names" {
  description = "Namespaces administrados por Terraform en el laboratorio local."
  value       = module.namespaces.names
}

output "kubeconfig_path" {
  description = "Archivo kubeconfig usado por el proveedor de Kubernetes."
  value       = local.kubeconfig_path
}
