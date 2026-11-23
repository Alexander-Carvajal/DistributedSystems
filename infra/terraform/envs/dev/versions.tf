terraform {
  required_version = "~> 1.17.0"

  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = ">= 2.30.0, < 3.0.0"
    }
  }

  backend "local" {}
}
