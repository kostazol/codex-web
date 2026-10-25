{
  flake-utils,
  nixpkgs,
  ...
}:
let
  systems = [
    "aarch64-darwin"
    "x86_64-darwin"
    "aarch64-linux"
    "x86_64-linux"
  ];
in
flake-utils.lib.eachSystem systems (
  system:
  let
    pkgs = import nixpkgs { inherit system; };
    version = "0.164.0-alpha.11.1";
    platform =
      {
        aarch64-darwin = {
          npm = "darwin-arm64";
          hash = "sha512-fyTZm1RgiOIqnXFrbjIXXESm+GQKYVFT7CPAS4SH3Pc5GZ7PRC+5DvAGJHeXAA1GfwaXOuouDoPxUFG5sIHDJw==";
        };
        x86_64-darwin = {
          npm = "darwin-x64";
          hash = "sha512-AFf/7c6Q6RNiIyucixliZt/KyCJptqtjVviNM03VEcLcKfmBfvN8S2A/c9Ip4QgbfSQMdQTBbO3srfQ9NCe4IA==";
        };
        aarch64-linux = {
          npm = "linux-arm64";
          hash = "sha512-kvAq4FdvbL7NeumC7cb5YJxWaQqQJwZQG5zZd7ZK1BpSSpi8iwNe66Ki56fO1+EXGLVAk47QWb0pVwEnaASBYw==";
        };
        x86_64-linux = {
          npm = "linux-x64";
          hash = "sha512-2xF9vvBvvJxiV3QF84oai04BMjcrBztP47H+hG0i0ZNlk8DZm/zZDWc/ptciKb69gXVGz9WMjOmbEhit2ZQCeQ==";
        };
      }
      .${system};
    src = pkgs.fetchurl {
      url = "https://registry.npmjs.org/@openai/codex/-/codex-${version}-${platform.npm}.tgz";
      hash = platform.hash;
    };
  in
  {
    packages.codex =
      pkgs.runCommand "codex-${version}"
        {
          pname = "codex";
          inherit src version;
        }
        ''
          tar -xzf "$src"
          # Keep the package metadata and bundled resources beside bin for discovery.
          mkdir -p "$out"
          cp -R package/vendor/*/. "$out/"
        '';
  }
)
