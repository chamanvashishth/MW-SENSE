{
  "version": 1,
  "symbols": [
    {
      "id": "soil_1",
      "type": "reg:capacitive-soil-moisture-v12",
      "ref": "U1",
      "x": 31,
      "y": 62,
      "rotation": 0,
      "mirror": false
    },
    {
      "id": "esp32_1",
      "type": "reg:esp32-devkit-v1",
      "ref": "U2",
      "x": 63,
      "y": 54,
      "rotation": 0,
      "mirror": false
    },
    {
      "id": "dht_1",
      "type": "reg:dht22",
      "ref": "U3",
      "x": 107,
      "y": 63,
      "rotation": 0,
      "mirror": false
    },
    {
      "id": "air_1",
      "type": "reg:sgp40-voc-sensor",
      "ref": "U4",
      "x": 107,
      "y": 42,
      "rotation": 0,
      "mirror": false
    },
    {
      "id": "dht_pullup",
      "type": "resistor",
      "ref": "R1",
      "x": 107,
      "y": 23,
      "rotation": 0,
      "value": "10k",
      "mirror": false
    }
  ],
  "wires": [
    {
      "id": "bbs_w_0",
      "points": [
        {
          "x": 69,
          "y": 42
        },
        {
          "x": 88,
          "y": 42
        },
        {
          "x": 88,
          "y": 80
        },
        {
          "x": 15,
          "y": 80
        },
        {
          "x": 15,
          "y": 61
        },
        {
          "x": 25,
          "y": 61
        }
      ],
      "net": "0"
    },
    {
      "id": "bbs_w_1",
      "points": [
        {
          "x": 69,
          "y": 42
        },
        {
          "x": 88,
          "y": 42
        },
        {
          "x": 88,
          "y": 53
        },
        {
          "x": 123,
          "y": 53
        },
        {
          "x": 123,
          "y": 63
        },
        {
          "x": 113,
          "y": 63
        }
      ],
      "net": "0"
    },
    {
      "id": "bbs_w_2",
      "points": [
        {
          "x": 69,
          "y": 42
        },
        {
          "x": 88,
          "y": 42
        },
        {
          "x": 88,
          "y": 44
        },
        {
          "x": 101,
          "y": 44
        }
      ],
      "net": "0"
    },
    {
      "id": "bbs_w_3",
      "points": [
        {
          "x": 25,
          "y": 61
        },
        {
          "x": 15,
          "y": 61
        },
        {
          "x": 15,
          "y": 42
        },
        {
          "x": 57,
          "y": 42
        }
      ],
      "net": "0"
    },
    {
      "id": "bbs_w_4",
      "points": [
        {
          "x": 69,
          "y": 40
        },
        {
          "x": 91,
          "y": 40
        },
        {
          "x": 91,
          "y": 12
        },
        {
          "x": 12,
          "y": 12
        },
        {
          "x": 12,
          "y": 63
        },
        {
          "x": 25,
          "y": 63
        }
      ],
      "net": "V33"
    },
    {
      "id": "bbs_w_5",
      "points": [
        {
          "x": 69,
          "y": 40
        },
        {
          "x": 91,
          "y": 40
        },
        {
          "x": 91,
          "y": 62
        },
        {
          "x": 101,
          "y": 62
        }
      ],
      "net": "V33"
    },
    {
      "id": "bbs_w_6",
      "points": [
        {
          "x": 69,
          "y": 40
        },
        {
          "x": 101,
          "y": 40
        }
      ],
      "net": "V33"
    },
    {
      "id": "bbs_w_7",
      "points": [
        {
          "x": 69,
          "y": 40
        },
        {
          "x": 91,
          "y": 40
        },
        {
          "x": 91,
          "y": 31
        },
        {
          "x": 107,
          "y": 31
        },
        {
          "x": 107,
          "y": 26
        }
      ],
      "net": "V33"
    },
    {
      "id": "bbs_w_8",
      "points": [
        {
          "x": 37,
          "y": 62
        },
        {
          "x": 57,
          "y": 62
        }
      ],
      "net": "N_IO34"
    },
    {
      "id": "bbs_w_9",
      "points": [
        {
          "x": 57,
          "y": 44
        },
        {
          "x": 47,
          "y": 44
        },
        {
          "x": 47,
          "y": 77
        },
        {
          "x": 79,
          "y": 77
        },
        {
          "x": 79,
          "y": 64
        },
        {
          "x": 101,
          "y": 64
        }
      ],
      "net": "N_IO13"
    },
    {
      "id": "bbs_w_10",
      "points": [
        {
          "x": 107,
          "y": 20
        },
        {
          "x": 107,
          "y": 15
        },
        {
          "x": 47,
          "y": 15
        },
        {
          "x": 47,
          "y": 44
        },
        {
          "x": 57,
          "y": 44
        }
      ],
      "net": "N_IO13"
    },
    {
      "id": "bbs_w_11",
      "points": [
        {
          "x": 69,
          "y": 60
        },
        {
          "x": 85,
          "y": 60
        },
        {
          "x": 85,
          "y": 73
        },
        {
          "x": 126,
          "y": 73
        },
        {
          "x": 126,
          "y": 43
        },
        {
          "x": 113,
          "y": 43
        }
      ],
      "net": "N_IO21"
    },
    {
      "id": "bbs_w_12",
      "points": [
        {
          "x": 69,
          "y": 66
        },
        {
          "x": 82,
          "y": 66
        },
        {
          "x": 82,
          "y": 76
        },
        {
          "x": 129,
          "y": 76
        },
        {
          "x": 129,
          "y": 41
        },
        {
          "x": 113,
          "y": 41
        }
      ],
      "net": "N_IO22"
    }
  ],
  "junctions": [
    {
      "id": "j_69_42",
      "x": 69,
      "y": 42
    },
    {
      "id": "j_88_42",
      "x": 88,
      "y": 42
    },
    {
      "id": "j_15_61",
      "x": 15,
      "y": 61
    },
    {
      "id": "j_88_53",
      "x": 88,
      "y": 53
    },
    {
      "id": "j_88_44",
      "x": 88,
      "y": 44
    },
    {
      "id": "j_69_40",
      "x": 69,
      "y": 40
    },
    {
      "id": "j_91_40",
      "x": 91,
      "y": 40
    },
    {
      "id": "j_91_31",
      "x": 91,
      "y": 31
    },
    {
      "id": "j_47_44",
      "x": 47,
      "y": 44
    }
  ],
  "netLabels": [
    {
      "id": "bbs_nl_0",
      "name": "GND",
      "x": 88,
      "y": 42,
      "anchor": "start"
    },
    {
      "id": "bbs_nl_1",
      "name": "V33",
      "x": 91,
      "y": 39,
      "anchor": "start"
    },
    {
      "id": "bbs_nl_2",
      "name": "N_IO34",
      "x": 57,
      "y": 62,
      "owner": "esp32_1",
      "anchor": "end"
    },
    {
      "id": "bbs_nl_3",
      "name": "N_IO13",
      "x": 47,
      "y": 44,
      "anchor": "end"
    },
    {
      "id": "bbs_nl_4",
      "name": "N_IO21",
      "x": 85,
      "y": 61,
      "anchor": "end"
    },
    {
      "id": "bbs_nl_5",
      "name": "N_IO22",
      "x": 82,
      "y": 74,
      "anchor": "start"
    }
  ],
  "probes": [],
  "directives": [],
  "breadboardSync": {
    "sourceHash": "16944:610571306",
    "symbolIds": [
      "soil_1",
      "esp32_1",
      "dht_1",
      "air_1",
      "dht_pullup"
    ],
    "wireIds": [
      "bbs_w_0",
      "bbs_w_1",
      "bbs_w_2",
      "bbs_w_3",
      "bbs_w_4",
      "bbs_w_5",
      "bbs_w_6",
      "bbs_w_7",
      "bbs_w_8",
      "bbs_w_9",
      "bbs_w_10",
      "bbs_w_11",
      "bbs_w_12"
    ],
    "netLabelIds": [
      "bbs_nl_0",
      "bbs_nl_1",
      "bbs_nl_2",
      "bbs_nl_3",
      "bbs_nl_4",
      "bbs_nl_5"
    ],
    "powerPortIds": [],
    "places": {
      "soil_1": {
        "x": 31,
        "y": 62,
        "rotation": 0,
        "mirror": false
      },
      "esp32_1": {
        "x": 63,
        "y": 54,
        "rotation": 0,
        "mirror": false
      },
      "dht_1": {
        "x": 107,
        "y": 63,
        "rotation": 0,
        "mirror": false
      },
      "air_1": {
        "x": 107,
        "y": 42,
        "rotation": 0,
        "mirror": false
      },
      "dht_pullup": {
        "x": 107,
        "y": 23,
        "rotation": 0,
        "mirror": false
      }
    }
  }
}