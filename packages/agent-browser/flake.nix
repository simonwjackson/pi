{
  description = "Browser automation CLI for AI agents";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      version = "0.23.4";

      platforms = {
        "x86_64-linux" = {
          binary = "agent-browser-linux-x64";
          hash = "sha256-WT+AXFE5MBqMD8rIg1N4JN7rjcwqQcSNBqPbzYqpPX0=";
        };
        "aarch64-linux" = {
          binary = "agent-browser-linux-arm64";
          hash = "sha256-uLi7Ksem211kEFQaa00yIDbGM8IN8GyY/HzE6vtji18=";
        };
        "x86_64-darwin" = {
          binary = "agent-browser-darwin-x64";
          hash = "sha256-uLi7Ksem211kEFQaa00yIDbGM8IN8GyY/HzE6vtji18=";
        };
        "aarch64-darwin" = {
          binary = "agent-browser-darwin-arm64";
          hash = "sha256-uLi7Ksem211kEFQaa00yIDbGM8IN8GyY/HzE6vtji18=";
        };
      };

      forAllSystems = nixpkgs.lib.genAttrs (builtins.attrNames platforms);
    in
    {
      packages = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          platformInfo = platforms.${system};

          src = pkgs.fetchurl {
            url = "https://registry.npmjs.org/agent-browser/-/agent-browser-${version}.tgz";
            hash = platformInfo.hash;
          };
        in
        {
          default = pkgs.stdenv.mkDerivation {
            pname = "agent-browser";
            inherit version src;

            sourceRoot = "package";

            nativeBuildInputs = with pkgs; [ autoPatchelfHook makeWrapper ];
            buildInputs = with pkgs; [ stdenv.cc.cc.lib ];

            dontBuild = true;
            dontConfigure = true;

            installPhase = ''
              runHook preInstall

              mkdir -p $out/bin $out/lib/agent-browser
              cp bin/${platformInfo.binary} $out/lib/agent-browser/agent-browser
              chmod +x $out/lib/agent-browser/agent-browser

              makeWrapper $out/lib/agent-browser/agent-browser $out/bin/agent-browser

              runHook postInstall
            '';

            meta = with pkgs.lib; {
              description = "Browser automation CLI for AI agents";
              homepage = "https://agent-browser.dev";
              license = licenses.asl20;
              platforms = [ system ];
              mainProgram = "agent-browser";
            };
          };
        }
      );
    };
}
