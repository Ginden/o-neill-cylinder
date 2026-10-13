uniform sampler2D uImage;
uniform float uExposure;
uniform int uDiagnostic;
uniform vec2 uDisplayResolution;
out vec4 outColor;
vec3 aces(vec3 x) {
  return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);
}
void main() {
  vec3 color=texture(uImage,gl_FragCoord.xy/uDisplayResolution).rgb;
  if (uDiagnostic==0) {
    color=vec3(dot(vec3(3.2406,-1.5372,-0.4986),color),dot(vec3(-0.9689,1.8758,0.0415),color),dot(vec3(0.0557,-0.2040,1.0570),color));
    color=aces(max(color,vec3(0.0))*uExposure);
  }
  color=mix(color*12.92,1.055*pow(max(color,vec3(0.0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),color));
  outColor=vec4(color,1.0);
}
