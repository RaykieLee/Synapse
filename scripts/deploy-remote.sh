#!/usr/bin/env bash
set -Eeuo pipefail

release_dir="${1:?release directory is required}"
image_tag="${2:?image tag is required}"
base_dir="/opt/synapse"
state_dir="${base_dir}/state"
current_env="${state_dir}/current.env"
previous_env="${state_dir}/previous.env"
previous_compose="${state_dir}/previous-compose.yml"
new_env="${state_dir}/release-${image_tag}.env"
current_release="${state_dir}/current-release-dir"
previous_release="${state_dir}/previous-release-dir"
release_compose="${release_dir}/docker-compose.deploy-host.yml"
compose_files=(-f "${base_dir}/docker-compose.yml")
compose_env="${new_env}"
compose_tmp=""

run_compose() {
  docker compose \
    --project-directory "${base_dir}" \
    --env-file "${base_dir}/.env.docker" \
    --env-file "${compose_env}" \
    "$@"
}

cleanup() {
  if [[ -n "${compose_tmp}" ]]; then
    rm -f "${compose_tmp}"
  fi
}
trap cleanup EXIT

if [[ ! -r "${base_dir}/.env.docker" ]]; then
  echo "Missing ${base_dir}/.env.docker" >&2
  exit 1
fi
if [[ ! -r "${release_compose}" || ! -r "${release_dir}/release.env" ]]; then
  echo "Incomplete release bundle in ${release_dir}" >&2
  exit 1
fi
if [[ ! -r "${release_dir}/synapse-images.tar.gz" ]]; then
  echo "Missing image bundle in ${release_dir}" >&2
  exit 1
fi
if [[ ! -r "${release_dir}/synapse-images.tar.gz.sha256" ]]; then
  echo "Missing image bundle checksum in ${release_dir}" >&2
  exit 1
fi
(cd "${release_dir}" && sha256sum -c synapse-images.tar.gz.sha256)
mkdir -p "${state_dir}"
if [[ -s "${current_env}" ]]; then
  cp "${current_env}" "${previous_env}"
  if [[ -s "${current_release}" ]]; then
    cp "${current_release}" "${previous_release}"
  else
    rm -f "${previous_release}"
  fi
else
  rm -f "${previous_env}" "${previous_compose}" "${previous_release}"
fi
if [[ -s "${base_dir}/docker-compose.yml" ]]; then
  cp "${base_dir}/docker-compose.yml" "${previous_compose}"
fi

cp "${release_dir}/release.env" "${new_env}"

echo "Loading release images ${image_tag}"
gzip -dc "${release_dir}/synapse-images.tar.gz" | docker load

# The application archive intentionally excludes infrastructure images. Pull
# them only when a fresh host does not already have both local images.
if ! docker image inspect redis:7-alpine qdrant/qdrant:latest >/dev/null 2>&1; then
  echo "Pulling missing infrastructure images"
  run_compose pull redis qdrant
fi

compose_tmp="$(mktemp "${base_dir}/.docker-compose.XXXXXX")"
cp "${release_compose}" "${compose_tmp}"
chmod 644 "${compose_tmp}"
mv -f "${compose_tmp}" "${base_dir}/docker-compose.yml"
compose_tmp=""

echo "Starting release ${image_tag}"
if ! run_compose "${compose_files[@]}" up -d --no-build --remove-orphans --wait --wait-timeout 600; then
  echo "Release ${image_tag} failed health checks." >&2
  run_compose "${compose_files[@]}" ps || true
  run_compose "${compose_files[@]}" logs --tail=200 api web || true

  if [[ -s "${previous_env}" ]]; then
    echo "Rolling back to the previous release." >&2
    compose_env="${previous_env}"
    previous_release_dir="$(cat "${previous_release}" 2>/dev/null || true)"
    if [[ -n "${previous_release_dir}" && -s "${previous_release_dir}/docker-compose.deploy-host.yml" ]]; then
      cp "${previous_release_dir}/docker-compose.deploy-host.yml" "${base_dir}/docker-compose.yml"
    elif [[ -s "${previous_compose}" ]]; then
      cp "${previous_compose}" "${base_dir}/docker-compose.yml"
    fi
    run_compose "${compose_files[@]}" up -d --no-build --remove-orphans --wait --wait-timeout 600
  else
    run_compose "${compose_files[@]}" down --remove-orphans
  fi
  exit 1
fi

cp "${new_env}" "${current_env}"
printf '%s\n' "${release_dir}" > "${current_release}"
rm -f "${release_dir}/synapse-images.tar.gz"
rm -f "${release_dir}/synapse-images.tar.gz.sha256"
run_compose "${compose_files[@]}" ps
echo "Release ${image_tag} is healthy."
