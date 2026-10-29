import * as THREE from 'three';
import * as xb from 'xrblocks';

/**
 * A basic example of XR Blocks to render a cylinder and pinch to change color.
 */
class MainScript extends xb.Script {
  player?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial>;

  init() {
    this.add(new THREE.HemisphereLight(0xffffff, 0x666666, /*intensity=*/ 3));

    const geometry = new THREE.CylinderGeometry(
      0.2,
      0.2,
      0.4,
      /*segments=*/ 32,
    );
    const material = new THREE.MeshPhongMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
    });
    this.player = new THREE.Mesh(geometry, material);
    this.player.position.set(0, xb.user.height - 0.5, -xb.user.objectDistance);
    this.add(this.player);
  }

  /**
   * Changes the color of the mesh on a pinch in XR.
   * @param event event.target holds controller / hand data.
   */
  onSelectEnd(event: xb.SelectEvent) {
    this.player?.material.color.set(Math.random() * 0xffffff);
  }

  /**
   * Changes the color of the mesh to blue during pinching in XR.
   * @param event The controller / hand event.
   */
  onSelecting(event: xb.SelectEvent) {
    this.player?.material.color.set(0x66ccff);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  xb.add(new MainScript());
  xb.init(new xb.Options());
});
